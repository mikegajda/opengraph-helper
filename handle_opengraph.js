const {promisify} = require('util');
const stringHash = require("string-hash");
let ogs = require('open-graph-scraper');
const potrace = require('potrace');
const fs = require('fs')
const path = require('path')
const axios = require('axios')
const SVGO = require('svgo');
const sharp = require('sharp')
const AWS = require('aws-sdk');
ogs = promisify(ogs).bind(ogs);

let awsKeyId = process.env.AWS_KEY_ID;
let awsSecretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

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

async function uploadToAmazon(file) {
  // Read content from the file
  const fileContent = fs.readFileSync(file);
  let parsedFilePath = path.parse(file);

  // Setting up S3 upload parameters
  const params = {
    Bucket: "cdn.mikegajda.com",
    Key: parsedFilePath.name + parsedFilePath.ext, // File name you want to save as in S3
    Body: fileContent,
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

function ensureDirectoryExistence(filePath) {
  let dirname = path.dirname(filePath);
  if (fs.existsSync(dirname)) {
    return true;
  }
  ensureDirectoryExistence(dirname);
  fs.mkdirSync(dirname);
}


async function downloadOGImage(url, urlHashKey) {
  const urlToPath = path.parse(url)
  const hash = urlHashKey
  const realExt = urlToPath.ext.split("?")[0]
  const pathToOutputFile = path.resolve(__dirname, "output", hash + realExt)
  ensureDirectoryExistence(pathToOutputFile)
  const writer = fs.createWriteStream(pathToOutputFile)

  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream'
  })

  response.data.pipe(writer)

  return new Promise((resolve, reject) => {
    writer.on('finish', () => {
      resolve(pathToOutputFile)
    })
    writer.on('error', reject)
  })
}

async function createSvg(filePath, params) {
  return new Promise((resolve, reject) => {
    let parsedFilePath = path.parse(filePath);
    potrace.trace(filePath, params, function (err, svg) {
      if (err) {
        reject();
      } else {
        svgo.optimize(svg).then(function (optimizedSvg) {
          let svgPath = path.join(parsedFilePath.dir,
              parsedFilePath.name + ".svg");
          fs.writeFileSync(svgPath, optimizedSvg.data);
          resolve(svgPath);
        })

      }
    });
  });

}

async function resizeImage(filePath) {
  let parsedFilePath = path.parse(filePath);
  let newFilePath = path.join(parsedFilePath.dir,
      parsedFilePath.name + "_100w" + parsedFilePath.ext);
  await sharp(filePath)
  .resize({ width: 100 })
  .toFile(newFilePath);
  return newFilePath;

}

async function writeOhResponseToFile(OGResponse, key){
  let data = JSON.stringify(OGResponse, null, 2);

  return new Promise((resolve, reject) => {
    fs.writeFile(key + '.json', data, (err) => {
      if (err) reject();
      resolve(path.join(__dirname, key + ".json"))
    });
  })

}

async function processOgImage(url) {
  let options = {
    'url': url
  };

  let urlHashKey = stringHash(url);

  let response = await ogs(options)
  let ogResopnseFilePath = await writeOhResponseToFile(response, urlHashKey);
  let ogResponseUplaod = await uploadToAmazon(ogResopnseFilePath);
  console.log("ogResponseFilePath=", ogResponseUplaod)
  if (response.data && response.data.ogImage && response.data.ogImage.url) {
    console.log(response.data.ogImage.url);
    let pathToDownloadedImage = await downloadOGImage(response.data.ogImage.url, urlHashKey);
    console.log("pathToDownloadedImage", pathToDownloadedImage);

    let pathToOptimizedImage = await resizeImage(pathToDownloadedImage);
    let ogImageAwsUpload = await uploadToAmazon(pathToDownloadedImage);
    console.log("ogImageAwsUpload=", ogImageAwsUpload);

    let pathToOptimizedImageAwsUpload = await uploadToAmazon(pathToOptimizedImage);
    console.log("pathToOptimizedImageAwsUpload=", pathToOptimizedImageAwsUpload);
    let svgParams = {
      color: `lightgray`,
      optTolerance: 0.4,
      turdSize: 500,
      threshold: potrace.Potrace.THRESHOLD_AUTO,
      turnPolicy: potrace.Potrace.TURNPOLICY_MAJORITY,
    }
    let pathToSvg = await createSvg(pathToOptimizedImage, svgParams);
    console.log(pathToSvg);

    let awsInfo = await uploadToAmazon(pathToSvg);
    console.log("awsInfo=", awsInfo);
  }
}

(async () => {
  try {
    await processOgImage(
        'https://www.theatlantic.com/health/archive/2019/09/dangers-peanut-allergy-drug/597997/')
  } catch (e) {
    console.error(e)
    // Deal with the fact the chain failed
  }
})();
