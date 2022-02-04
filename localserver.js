const path = require("path")
const express = require("express")
const app = require("./public/App.js")
const request = require('request')

const server = express()

server.use(express.static(path.join(__dirname, "public")))

server.get("*", (req, res) => {
    const { html } = app.render({ url: req.url })

    res.write(`
    <!DOCTYPE html>
    <script src="https://cdn.alloyui.com/3.0.1/aui/aui-min.js"></script>
    <link href='https://fonts.googleapis.com/css?family=Roboto Mono' rel='stylesheet'>
    <link rel='stylesheet' href='/global.css'>
    <link rel='stylesheet' href='/bundle.css'>
    <script src="https://ajax.googleapis.com/ajax/libs/jquery/1.11.0/jquery.min.js"></script>
    <link rel='stylesheet' href='/mathquill.css'>
    <script src="/mathquill.js"></script>
    <script>
    window.MQ = MathQuill.getInterface(2)
    </script>
    <div id="app">${html}</div>
    <script src="https://www.desmos.com/api/v1.6/calculator.js?apiKey=dcb31709b452b1cf9dc26972add0fda6"></script>
    <script src="/bundle.js"></script>
    `)
    // <link href="https://cdn.alloyui.com/3.0.1/aui-css/css/bootstrap.min.css" rel="stylesheet"></link>

    res.end()
})

server.listen(80)

