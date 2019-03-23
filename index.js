let http = require('http');
let express = require('express')
let request = require('request')
let io = require('socket.io')
let Webhooks = require('./src/webhooks')

const port = process.env.PORT || 8081

// Set up the URLS for this server.
let baseUrl = 'http://localhost'
if (process.env.HEROKU_URL) {
    baseUrl = process.env.HEROKU_URL
}
let callbackUrl = baseUrl + '/_twitch_webhooks'

// Create server instances
const app = express()
let server = http.Server(app);
let socket = io(server);

// Global vars for server.
let clientId = 'fmjgn1bqxpw7p0xgvryoe6027483ve'
let clientSecret = process.env.CLIENT_SECRET || 's1u6yj9aexfmn7pp0vvgeiwfktbmar'
let streamId = 'firstinspires1'

// This serves the static files for the JS client program.
app.use(express.static('static'))

// This is the Twitch API proxy used by the client to make Twitch API calls.
// TODO: Remove this in favor of all API calls originating fromt he server.
app.get('/_twitch', (req, res) => {
    let query = req.query
    const turl = query.qs.turl
    delete query.qs.turl
    const options = {
        headers: {
            'Client-ID': clientId,
            'User-Agent': 'request',
        }
    }
    let opts = Object.assign({}, options, {
        url: turl,
        qs: query.qs,
    })
    console.log(`Proxy HTTP call to ${turl}...`)
    request(opts, (error, resp, rawBody) => {
        let body = JSON.parse(rawBody)
        if (resp.statusCode !== 200) {
            console.log('%s: %s', body.error, body.message)
            process.exit()
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(rawBody);
    })
})

// This is the URL that Twitch will call with webhook subscription updates.
// We are simply broadcasting them to the client.
app.get('/_twitch_webhooks', (req, res) => {
    console.warn('webhook received!')
    let q = req.query
    // this could be a subscription challenge
    if (q['hub.mode']) {
        let code = q['hub.challenge']
        console.log('returning hub.challenge')
        res.status(200).end(code)
    } else {
        console.log('Passing webhook payload to socket client.')
        socket.emit('webhook', q);
        res.end()
    }
})

// Following the Twitch API authentication flow by getting an app access token.
function authenticate(cb) {
    let opts = {
        url: 'https://www.reddit.com/r/funny.json',
        headers: {
            'Client-ID': clientId,
            'Authorization': `Bearer ${clientSecret}`,
        },
        json: {
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'client_credentials',
            scope:'',
        }
    };
    request.post('https://id.twitch.tv/oauth2/token', opts, (error, resp, body) => {
        console.log('auth returned... storing access token')
        cb(body.access_token)
    })
}

function getUser(login, cb) {
    request('https://api.twitch.tv/helix/users', {
        headers: {
            'Client-ID': clientId,
            'User-Agent': 'request',
        },
        qs: {
            login: login,
        }
    }, (error, resp, rawBody) => {
        cb(JSON.parse(rawBody).data[0])
    })

}

function startServer() {
    server.listen(port, function(){
        console.log(`serving HTML from ${baseUrl}:${port}/index.html`)
        console.log(`listening on *:${port}`);
    });
    socket.on('connect', function(){
        console.log('Connected to socket client.')
    });
    socket.on('disconnect', function(){
        console.log('Disconnected from socket client.')
    });
}

// Program start
startServer()
authenticate((token) => {
    if (! token) throw new Error('Cannot get app token')
    getUser(streamId, (user) => {
        let webhooks = new Webhooks(user, callbackUrl, token)
        webhooks.updateWebhookSubscriptions(user, token)
    })
})
