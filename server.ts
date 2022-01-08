import path from "path";
import express from "express";
import app from "./public/App.js";

const server = express();

server.use(express.static(path.join(__dirname, "public")));

server.get("*", function(req, res) {
  const { html } = app.render({ url: req.url });

  res.write(`
    <!DOCTYPE html>
    <link href='https://fonts.googleapis.com/css?family=Roboto Mono' rel='stylesheet'>
    <link rel='stylesheet' href='/global.css'>
    <link rel='stylesheet' href='/bundle.css'>
    <div id="app">${html}</div>
    <script src="/bundle.js"></script>
  `);

  res.end();
});

const port = 3000;
server.listen(port, () => console.log(`Listening on port ${port}`));