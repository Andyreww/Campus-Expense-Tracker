const https = require('https');

exports.handler = async function(event, context) {
    const { lat, lon } = event.queryStringParameters;
    const apiKey = process.env.OPENWEATHERMAP_API_KEY; 

    if (!apiKey) {
        console.error("Function Error: OPENWEATHERMAP_API_KEY is missing from Netlify environment variables.");
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'API key is not configured on the server.' }),
        };
    }

    if (!lat || !lon) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'Latitude (lat) and Longitude (lon) are required.' }),
        };
    }

    const apiUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=imperial`;

    // This is a promise-based way to use the built-in https library
    return new Promise((resolve, reject) => {
        const req = https.get(apiUrl, (res) => {
            let data = '';
            
            // A chunk of data has been received.
            res.on('data', (chunk) => {
                data += chunk;
            });

            // The whole response has been received.
            res.on('end', () => {
                try {
                    const weatherData = JSON.parse(data);
                    if (res.statusCode !== 200) {
                         console.error("OpenWeatherMap API Error:", weatherData);
                         resolve({
                             statusCode: weatherData.cod || 500,
                             body: JSON.stringify(weatherData),
                         });
                    } else {
                        resolve({
                            statusCode: 200,
                            headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
                            body: JSON.stringify(weatherData),
                        });
                    }
                } catch (e) {
                    console.error("JSON Parsing Error:", e);
                    resolve({ statusCode: 500, body: JSON.stringify({ error: "Failed to parse weather data." }) });
                }
            });
        });

        req.on('error', (e) => {
            console.error("HTTPS Request Error:", e);
            resolve({ statusCode: 500, body: JSON.stringify({ error: "Failed to fetch weather data due to a network error." }) });
        });
        
        // Set a timeout for the request
        req.setTimeout(10000, () => {
            req.destroy();
            console.error("Request timed out.");
            resolve({ statusCode: 504, body: JSON.stringify({ error: "Request timed out." }) });
        });
        
        req.end();
    });
};