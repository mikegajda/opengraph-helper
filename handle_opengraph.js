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

async function checkIfFileExistsInS3(filename){
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

async function getFileInS3(filename){
  const params = {
    Bucket: "cdn.mikegajda.com",
    Key: filename
  };
  return new Promise((resolve, reject) => {
    s3.getObject(params, function(err, data) {
      if (err)
        reject(err)

      resolve(data.Body.toString());
    });
  })

}

async function getOpenGraphInfo(url){
  return new Promise((resolve, reject) => {
    ogs({
      url: url
    }, function (error, results) {
      resolve(results)
    });
  })

}

async function processOgData(ogData, urlHashKey){
  let awsResponse

  if (ogData.ogImage && ogData.ogImage.url) {
    let image = await Jimp.read(ogData.ogImage.url)
    if (image.getWidth() > 1400) {
      image = image.resize(1400, Jimp.AUTO);
    }
    let imageBuffer = await image.getBufferAsync("image/jpeg");

    awsResponse = await uploadBufferToAmazon(imageBuffer,
        `${urlHashKey}_${image.getWidth()}w_${image.getHeight()}h.jpg`);
    console.log("awsResponse=", awsResponse.Location);

    let smallerImageBuffer = await image.clone().quality(60).resize(100,
        Jimp.AUTO).getBufferAsync("image/jpeg");
    awsResponse = await uploadBufferToAmazon(smallerImageBuffer,
        urlHashKey + "_100w.jpg");
    console.log("awsResponse=", awsResponse.Location);

    let svgParams = {
      color: `lightgray`,
      optTolerance: 0.4,
      turdSize: 500,
      threshold: potrace.Potrace.THRESHOLD_AUTO,
      turnPolicy: potrace.Potrace.TURNPOLICY_MAJORITY,
    }
    let svgBuffer = await createSvg(smallerImageBuffer, svgParams);
    awsResponse = await uploadBufferToAmazon(svgBuffer,
        urlHashKey + ".svg");
    console.log("awsResponse=", awsResponse.Location);

    // finally, update ogData to reflect that we have gotten the image
    ogData["processedImageHash"] = `${urlHashKey}_${image.getWidth()}w_${image.getHeight()}h.jpg`
  }

  awsResponse = await uploadBufferToAmazon(JSON.stringify(ogData),
      urlHashKey + ".json");
  console.log("awsResponse=", awsResponse.Location);
  return ogData;
}

async function fetchOgMetadataAndImagesAndUploadToAWS(url, urlHashKey){

  let ogInfo = await getOpenGraphInfo(url);

  if (ogInfo["success"]){
    ogInfo["data"]["success"] = true
    return await processOgData(ogInfo["data"], urlHashKey)
  }
  else {
    return {
      success: false,
      ogUrl: url
    }
  }
}

async function processUrl(url, breakCache) {
  let urlHashKey = stringHash(url);

  let existsInS3 = await checkIfFileExistsInS3(`${urlHashKey}.json`)
  if (existsInS3 && !breakCache){
    try {
      console.log("found in S3, will return early")
      let stringifiedJson = await getFileInS3(`${urlHashKey}.json`)
      return JSON.parse(stringifiedJson)
    }
    catch (e){
      console.error("Error while fetching file, will instead do a new fetch")
      return await fetchOgMetadataAndImagesAndUploadToAWS(url, urlHashKey)
    }
  }
  else {
    let response = await fetchOgMetadataAndImagesAndUploadToAWS(url, urlHashKey)
    return response
  }
}

// (async () => {
//   try {
//     await processUrl(
//         'https://www.theatlantic.com/health/archive/2019/09/dangers-peanut-allergy-drug/597997/')
//   } catch (e) {
//     console.error(e)
//     // Deal with the fact the chain failed
//   }
// })();

module.exports.processUrl = processUrl
