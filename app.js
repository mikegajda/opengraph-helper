'use strict';
const express = require('express');
const serverless = require('serverless-http');
const app = express();
const cors = require('cors');
const fs = require('fs');
let handle_opengraph = require("./handle_opengraph");

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