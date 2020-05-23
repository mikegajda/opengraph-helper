'use strict';
const express = require('express');
const serverless = require('serverless-http');
const app = express();
const cors = require('cors');

app.use(express.json())
app.use(cors())


const router = express.Router()
router.get('/opengraph-info', (req, res) => {
  res.json({"url": req.query["url"]});
});

// point the base route at the router
app.use('/', router)

// special for netlify functions, point /.netlify/functions at the router
app.use('/.netlify/functions/app', router) // route to netlify lambda

module.exports = app
module.exports.handler = serverless(app);