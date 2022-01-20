const path = require("path")
const express = require("express")
const app = require("./public/App.js")
const http = require('http')
const https = require('https')
const fs = require('fs')
const request = require('request')

const server = express()

const privateKey = fs.readFileSync('privkey1.pem')
const cert = fs.readFileSync('fullchain1.pem')

server.use(express.static(path.join(__dirname, "public")))
server.use('/api', (req, res) => {
    console.log('apirequest')
    const url = 'http://localhost:3000/api' + req.url
    console.log(url)
    request(url, { method: req.method }).pipe(res)
})

server.get("*", (req, res) => {
    const { html } = app.render({ url: req.url })

    res.write(`
    <!DOCTYPE html>
    <link href='https://fonts.googleapis.com/css?family=Roboto Mono' rel='stylesheet'>
    <link rel='stylesheet' href='/global.css'>
    <link rel='stylesheet' href='/bundle.css'>
    <div id="app">${html}</div>
    <script src="/bundle.js"></script>
  `)

    res.end()
})

https.createServer({ key: privateKey, cert }, server).listen(443)

const redirectServer = express()
redirectServer.get('*', (req, res) => {
    res.redirect('https://' + req.headers.host + req.url)
})
redirectServer.listen(80)
