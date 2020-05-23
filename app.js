'use strict';
const express = require('express');
const serverless = require('serverless-http');
const app = express();
const cors = require('cors');
let handle_opengraph = require("./handle_opengraph");

app.use(express.json())
app.use(cors())

const router = express.Router()
router.get('/opengraph-info', async (req, res) => {
  let response = await handle_opengraph.processUrl(req.query["url"])
  res.json({
    "url": req.query["url"],
    "response": response
  });
});

// point the base route at the router
app.use('/', router)

// special for netlify functions, point /.netlify/functions at the router
app.use('/.netlify/functions/app', router) // route to netlify lambda

module.exports = app
module.exports.handler = serverless(app);