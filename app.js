'use strict';
const express = require('express');
const serverless = require('serverless-http');
const app = express();
const cors = require('cors');
let handle_opengraph = require("./handle_opengraph");

let allowedDomains = ["https://mikegajda.com", "https://michaelgajda.com", /\.mikegajda\.com$/, /\.michaelgajda\.com$/, /\.mikegajda\.netlify\.app$/]
app.use(express.json())
app.use(cors({
  origin: allowedDomains
}))

const router = express.Router()
router.get('/opengraph-info', async (req, res) => {
  let response = await handle_opengraph.processUrl(req.query["url"], req.query["breakCache"] === "true", req.query["backgroundColor"])
  res.json(response);
});

router.get('/hashtag/:hashtag', async (req, res) => {
  let response = await handle_opengraph.getRelatedHashTags(req.params['hashtag'])
  res.json(response);
});
// point the base route at the router
app.use('/', router)

// special for netlify functions, point /.netlify/functions at the router
app.use('/.netlify/functions/app', router) // route to netlify lambda

module.exports = app
module.exports.handler = serverless(app);