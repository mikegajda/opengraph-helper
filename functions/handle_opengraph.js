const {promisify} = require('util');
const stringHash = require("string-hash");
let ogs = require('open-graph-scraper');
const potrace = require('potrace');
const SVGO = require('svgo');
const AWS = require('aws-sdk');
ogs = promisify(ogs).bind(ogs);
let Jimp = require('jimp');

let awsKeyId = process.env.MG_AWS_KEY_ID;
let awsSecretAccessKey = process.env.MG_AWS_SECRET_ACCESS_KEY;

const currentDir = process.env.LAMBDA_TASK_ROOT ? process.env.LAMBDA_TASK_ROOT + "/src/functions" : __dirname;

const s3 = new AWS.S3({
  accessKeyId: awsKeyId,
  secretAccessKey: awsSecretAccessKey
});

svgo = new SVGO({
  multipass: true,
  floatPrecision: 0,
  plugins: [
    {
      removeViewBox: false,
    },
    {
      addAttributesToSVGElement: {
        attributes: [
          {
            preserveAspectRatio: `none`,
          },
        ],
      },
    },
  ],
});

async function uploadBufferToAmazon(buffer, filename) {
  // Setting up S3 upload parameters
  const params = {
    Bucket: "cdn.mikegajda.com",
    Key: filename, // File name you want to save as in S3
    Body: buffer,
    ACL: "public-read"
  };

  return new Promise((resolve, reject) => {
    // Uploading files to the bucket
    s3.upload(params, function (err, data) {
      if (err) {
        reject(err);
      } else {
        resolve(data);
      }
    });
  })
}

async function createSvg(buffer, params) {
  return new Promise((resolve, reject) => {
    potrace.trace(buffer, params, function (err, svg) {
      if (err) {
        reject();
      } else {
        svgo.optimize(svg).then(function (optimizedSvg) {
          resolve(optimizedSvg.data);
        })
      }
    });
  });

}

async function checkIfFileExistsInS3(filename) {
  const params = {
    Bucket: "cdn.mikegajda.com",
    Key: filename, // File name you want to save as in S3
  };
  return new Promise((resolve, reject) => {
    // Uploading files to the bucket
    s3.headObject(params, function (err, data) {
      if (err) {
        resolve(false)
      } else {
        resolve(true)
      }
    });
  })
}

async function getFileInS3(filename) {
  const params = {
    Bucket: "cdn.mikegajda.com",
    Key: filename
  };
  return new Promise((resolve, reject) => {
    s3.getObject(params, function (err, data) {
      if (err) {
        reject(err)
      }

      resolve(data.Body.toString());
    });
  })

}

async function getOpenGraphInfo(url) {
  return new Promise((resolve, reject) => {
    ogs({
      url: url
    }, function (error, results) {
      resolve(results)
    });
  })

}

async function processOgData(ogData, urlHashKey) {
  let awsResponse

  if (ogData.ogImage && ogData.ogImage.url) {
    let ogImage = await Jimp.read(ogData.ogImage.url)
    if (ogImage.getWidth() > 1400) {
      ogImage = ogImage.resize(1400, Jimp.AUTO);
    }
    let imageBuffer = await ogImage.getBufferAsync("image/jpeg");

    let igStoryBuffer = await processIgStoryImageToBuffer(ogData, ogImage);
    let igFeedBuffer = await processIgFeedImageToBuffer(ogData, ogImage);

    awsResponse = await uploadBufferToAmazon(imageBuffer,
        `${urlHashKey}_${ogImage.getWidth()}w_${ogImage.getHeight()}h.jpg`);
    console.log("awsResponse=", awsResponse.Location);

    awsResponse = await uploadBufferToAmazon(igStoryBuffer,
        `${urlHashKey}_ig_story.jpg`);
    console.log("awsResponse=", awsResponse.Location);


    awsResponse = await uploadBufferToAmazon(igFeedBuffer,
        `${urlHashKey}_ig_feed.jpg`);
    console.log("awsResponse=", awsResponse.Location);


    awsResponse = await uploadBufferToAmazon(imageBuffer,
        `${urlHashKey}.jpg`);
    console.log("awsResponse=", awsResponse.Location);

    // let smallerImageBuffer = await ogImage.clone().quality(60).resize(100,
    //     Jimp.AUTO).getBufferAsync("image/jpeg");
    // awsResponse = await uploadBufferToAmazon(smallerImageBuffer,
    //     urlHashKey + "_100w.jpg");
    // console.log("awsResponse=", awsResponse.Location);
    //
    // let svgParams = {
    //   color: `lightgray`,
    //   optTolerance: 0.4,
    //   turdSize: 500,
    //   threshold: potrace.Potrace.THRESHOLD_AUTO,
    //   turnPolicy: potrace.Potrace.TURNPOLICY_MAJORITY,
    // }
    // let svgBuffer = await createSvg(smallerImageBuffer, svgParams);
    // awsResponse = await uploadBufferToAmazon(svgBuffer,
    //     urlHashKey + ".svg");
    // console.log("awsResponse=", awsResponse.Location);

    // finally, update ogData to reflect that we have gotten the ogImage
    ogData["processedImageHash"] = `${urlHashKey}.jpg`
  }

  awsResponse = await uploadBufferToAmazon(JSON.stringify(ogData),
      urlHashKey + ".json");
  console.log("awsResponse=", awsResponse.Location);
  return ogData;
}

async function fetchOgMetadataAndImagesAndUploadToAWS(url, urlHashKey) {

  let ogInfo = await getOpenGraphInfo(url);

  if (ogInfo["success"]) {
    ogInfo["data"]["success"] = true
    return await processOgData(ogInfo["data"], urlHashKey)
  } else {
    return {
      success: false,
      ogUrl: url
    }
  }
}

async function processUrl(url, breakCache) {
  let urlHashKey = stringHash(url);

  let existsInS3 = await checkIfFileExistsInS3(`${urlHashKey}.json`)
  if (existsInS3 && !breakCache) {
    try {
      console.log("found in S3, will return early")
      let stringifiedJson = await getFileInS3(`${urlHashKey}.json`)
      return JSON.parse(stringifiedJson)
    } catch (e) {
      console.error("Error while fetching file, will instead do a new fetch")
      return await fetchOgMetadataAndImagesAndUploadToAWS(url, urlHashKey)
    }
  } else {
    let response = await fetchOgMetadataAndImagesAndUploadToAWS(url, urlHashKey)
    return response
  }
}


function extractHostname(url) {
  var hostname;
  //find & remove protocol (http, ftp, etc.) and get hostname

  if (url.indexOf("//") > -1) {
    hostname = url.split('/')[2];
  } else {
    hostname = url.split('/')[0];
  }

  //find & remove port number
  hostname = hostname.split(':')[0];
  //find & remove "?"
  hostname = hostname.split('?')[0];

  // remove www. if it exists
  if (hostname.indexOf("www.") > -1) {
    hostname = hostname.split('www.')[1];
  }

  return hostname;
}

async function processIgStoryImageToBuffer(ogData, ogImage) {
  ogImage = ogImage.cover(1080, 960);
  // let imageBuffer = await ogImage.getBufferAsync("image/jpeg");

  let background = await new Jimp(1080, 1920, '#01bc84')

  let outputImage = background.composite(ogImage, 0, 185);


  // generated with https://ttf2fnt.com/
  let titleFont = await Jimp.loadFont(currentDir + '/GothicA1-SemiBold-85.ttf.fnt');
  let urlFont = await Jimp.loadFont(currentDir + '/GothicA1-Regular-50.ttf.fnt');

  let url = extractHostname(ogData.ogUrl)
  let title = ogData.ogTitle
  let footerText = "Link in bio"
  outputImage = await outputImage.print(urlFont, 50, 1180, url, 970);
  outputImage = await outputImage.print(titleFont, 50, 1255, title, 970);
  outputImage = await outputImage.print(urlFont, 50, 1815, {text: footerText, alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER}, 970);

  return await outputImage.getBufferAsync("image/jpeg");

}

async function processIgFeedImageToBuffer(ogData, ogImage) {
  ogImage = ogImage.cover(1080, 855);
  // let imageBuffer = await ogImage.getBufferAsync("image/jpeg");

  let background = await new Jimp(1080, 1080, '#01bc84')

  let outputImage = background.composite(ogImage, 0, 225);

  // generated with https://ttf2fnt.com/
  let titleFont = await Jimp.loadFont(currentDir + '/GothicA1-SemiBold-50.ttf.fnt');
  let urlFont = await Jimp.loadFont(currentDir + '/GothicA1-Regular-32.ttf.fnt');

  let url = extractHostname(ogData.ogUrl)
  let title = ogData.ogTitle
  outputImage = await outputImage.print(urlFont, 30, 30, url, 1050);
  outputImage = await outputImage.print(titleFont, 30, 85, title, 1050);

  return await outputImage.getBufferAsync("image/jpeg");

}

// (async () => {
//   try {
//     let ogData = await processUrl(
//         'https://www.nytimes.com/2020/06/05/sports/football/trump-anthem-kneeling-kaepernick.html?action=click&module=Top%20Stories&pgtype=Homepage', true)
//     // await processIgStoryImageToBuffer(ogData);
//     // await processIgFeedImageToBuffer(ogData);
//   } catch (e) {
//     console.error(e)
//     // Deal with the fact the chain failed
//   }
// })();

module.exports.processUrl = processUrl
