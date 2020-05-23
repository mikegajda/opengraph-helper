'use strict';
const express = require('express');
const serverless = require('serverless-http');
const app = express();
const cors = require('cors');

app.use(express.json())
app.use(cors())


const router = express.Router()
router.get('/test', (req, res) => {
  res.json({"key": "testValue"});
});

// point the base route at the router
app.use('/', router)

// special for netlify functions, point /.netlify/functions at the router
app.use('/.netlify/functions/index', router) // route to netlify lambda

module.exports = app
module.exports.handler = serverless(app);