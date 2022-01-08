import path from "path"
import express from "express"
import app from "./public/App.js"
import http from 'http'
import https from 'https'
import fs from 'fs'

const server = express()

const privateKey = fs.readFileSync('privatekey.pem')
const cert = fs.readFileSync('cert.pem')

server.use(express.static(path.join(__dirname, "public")))

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