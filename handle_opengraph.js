const {promisify} = require('util');
const stringHash = require("string-hash");
let ogs = require('open-graph-scraper');
const potrace = require('potrace');
const SVGO = require('svgo');
const AWS = require('aws-sdk');
ogs = promisify(ogs).bind(ogs);
let Jimp = require('jimp');
const url = require('url');

let awsKeyId = process.env.MG_AWS_KEY_ID;
let awsSecretAccessKey = process.env.MG_AWS_SECRET_ACCESS_KEY;

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

async function processOgData(ogData, urlHashKey, backgroundColor) {
  let awsResponse

  if (ogData.ogImage && ogData.ogImage.url) {
    let ogImage = await Jimp.read(ogData.ogImage.url)
    if (ogImage.getWidth() > 1400) {
      ogImage = ogImage.resize(1400, Jimp.AUTO);
    }
    ogImage = ogImage.quality(90)
    let imageBufferPromise = ogImage.getBufferAsync("image/jpeg");
    let igFeedBufferPromise = processIgFeedImageToBuffer(ogData, ogImage,
        backgroundColor);
    let igStoryBufferPromise = processIgStoryImageToBuffer(ogData, ogImage,
        backgroundColor);

    let [imageBuffer, igFeedBuffer, igStoryBuffer] = await Promise.all(
        [imageBufferPromise, igFeedBufferPromise, igStoryBufferPromise])
    console.log("got image buffers")

    let imageBufferAwsPromise = uploadBufferToAmazon(imageBuffer,
        `${urlHashKey}.jpg`);

    let igStoryBufferBufferAwsPromise = uploadBufferToAmazon(igStoryBuffer,
        `${urlHashKey}_ig_story.jpg`)

    let igFeedBufferBufferAwsPromise = uploadBufferToAmazon(igFeedBuffer,
        `${urlHashKey}_ig_feed.jpg`);

    let [response1, response2, response3] = await Promise.all(
        [imageBufferAwsPromise, igStoryBufferBufferAwsPromise,
          igFeedBufferBufferAwsPromise])
    console.log("awsResponse=", response1.Location);
    console.log("awsResponse=", response2.Location);
    console.log("awsResponse=", response3.Location);

    ogData["processedImageHash"] = `${urlHashKey}.jpg`
  }

  awsResponse = await uploadBufferToAmazon(JSON.stringify(ogData),
      urlHashKey + ".json");
  console.log("awsResponse=", awsResponse.Location);
  return ogData;
}

async function fetchOgMetadataAndImagesAndUploadToAWS(url, urlHashKey,
    backgroundColor) {

  let ogInfo = await getOpenGraphInfo(url);

  if (ogInfo["success"]) {
    ogInfo["data"]["success"] = true
    return await processOgData(ogInfo["data"], urlHashKey, backgroundColor)
  } else {
    return {
      success: false,
      ogUrl: url
    }
  }
}

async function processUrl(urlToParse, breakCache, backgroundColor = '01bc84') {
  let parsedUrl = url.parse(urlToParse);
  let cleanUrl = parsedUrl.protocol + "//" + parsedUrl.host + parsedUrl.pathname
  console.log("cleanUrl=", cleanUrl);
  let urlHashKey = stringHash(cleanUrl);

  let existsInS3 = await checkIfFileExistsInS3(`${urlHashKey}.json`)
  if (existsInS3 && !breakCache) {
    try {
      console.log("found in S3, will return early")
      let stringifiedJson = await getFileInS3(`${urlHashKey}.json`)
      return JSON.parse(stringifiedJson)
    } catch (e) {
      console.error("Error while fetching file, will instead do a new fetch")
      return await fetchOgMetadataAndImagesAndUploadToAWS(cleanUrl, urlHashKey,
          backgroundColor)
    }
  } else {
    let response = await fetchOgMetadataAndImagesAndUploadToAWS(cleanUrl,
        urlHashKey, backgroundColor)
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

function fixTitle(title){
  title = title.replace("’", "'")
  title = title.replace("‘", "'")
  title = title.replace("\"","'")
  title = title.replace("“", "'")
  title = title.replace("”", "'")
  return title
}

async function processIgStoryImageToBuffer(ogData, ogImage, backgroundColor) {
  ogImage = ogImage.cover(1080, 960);
  // let imageBuffer = await ogImage.getBufferAsync("image/jpeg");

  let background = await new Jimp(1080, 1920, `#${backgroundColor}`)

  let outputImage = background.composite(ogImage, 0, 185);

  // generated with https://ttf2fnt.com/
  let titleFont = await Jimp.loadFont(
      "https://s3.amazonaws.com/cdn.mikegajda.com/GothicA1-SemiBold-85/GothicA1-SemiBold.ttf.fnt");
  let urlFont = await Jimp.loadFont(
      "https://s3.amazonaws.com/cdn.mikegajda.com/GothicA1-Regular-50/GothicA1-Regular.ttf.fnt");

  let url = extractHostname(ogData.ogUrl)
  let title = fixTitle(ogData.ogTitle)
  let footerText = "Link in bio"
  outputImage = await outputImage.print(urlFont, 50, 1180, url, 970);
  outputImage = await outputImage.print(titleFont, 50, 1255, title, 970);
  outputImage = await outputImage.print(urlFont, 50, 1815,
      {text: footerText, alignmentX: Jimp.HORIZONTAL_ALIGN_CENTER}, 970);

  outputImage = outputImage.quality(90);
  return await outputImage.getBufferAsync("image/jpeg");

}

async function processIgFeedImageToBuffer(ogData, ogImage, backgroundColor) {
  ogImage = ogImage.cover(1080, 855);
  // let imageBuffer = await ogImage.getBufferAsync("image/jpeg");

  let background = await new Jimp(1080, 1080, `#${backgroundColor}`)

  let outputImage = background.composite(ogImage, 0, 225);

  // generated with https://ttf2fnt.com/
  let titleFont = await Jimp.loadFont(
      "https://s3.amazonaws.com/cdn.mikegajda.com/GothicA1-SemiBold-50/GothicA1-SemiBold.ttf.fnt");
  let urlFont = await Jimp.loadFont(
      "https://s3.amazonaws.com/cdn.mikegajda.com/GothicA1-Regular-32/GothicA1-Regular.ttf.fnt");

  let url = extractHostname(ogData.ogUrl)
  let title = fixTitle(ogData.ogTitle)
  outputImage = await outputImage.print(urlFont, 30, 30, url, 1020);
  outputImage = await outputImage.print(titleFont, 30, 85, title, 1020);

  outputImage = outputImage.quality(90);

  return await outputImage.getBufferAsync("image/jpeg");

}

// (async () => {
//   try {
//     let ogData = await processUrl(
//         'https://www.nytimes.com/interactive/2020/06/07/us/george-floyd-protest-aerial-photos.html?action=click&module=Top%20Stories&pgtype=Homepage', true)
//     // await processIgStoryImageToBuffer(ogData);
//     // await processIgFeedImageToBuffer(ogData);
//   } catch (e) {
//     console.error(e)
//     // Deal with the fact the chain failed
//   }
// })();

module.exports.processUrl = processUrl
