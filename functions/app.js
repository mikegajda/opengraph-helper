'use strict';
const express = require('express');
const serverless = require('serverless-http');
const app = express();
const cors = require('cors');
const fs = require('fs');
let handle_opengraph = require("./handle_opengraph");

let font1 = require('./GothicA1-Regular-32')
let font12 = require('./GothicA1-Regular-32/GothicA1-Regular-32.ttf.fnt')
let font2 = require('./GothicA1-Regular-32.ttf.fnt')
let font3 = require('./GothicA1-Regular-32.ttf_0.png')

app.use(express.json())
app.use(cors())

const router = express.Router()
router.get('/opengraph-info', async (req, res) => {
  console.log("i'm here")
  console.log("__dirname=", __dirname)
  fs.readdir(__dirname, function (err, files) {
    //handling error
    if (err) {
      return console.log('Unable to scan directory: ' + err);
    }
    //listing all files using forEach
    files.forEach(function (file) {
      // Do whatever you want to do with the file
      console.log(file);
    });
  });
  let response = await handle_opengraph.processUrl(req.query["url"], req.query["breakCache"] === "true")
  res.json(response);
});

// point the base route at the router
app.use('/', router)

// special for netlify functions, point /.netlify/functions at the router
app.use('/.netlify/functions/app', router) // route to netlify lambda

module.exports = app
module.exports.handler = serverless(app);