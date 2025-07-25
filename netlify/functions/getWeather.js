const https = require('https');

exports.handler = async function(event, context) {
    const { lat, lon } = event.queryStringParameters || {};
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
            body: JSON.stringify({ error: 'Missing required latitude and longitude parameters.' }),
        };
    }

    const apiUrl = `https://api.openweathermap.org/data/2.5/onecall?lat=${lat}&lon=${lon}&appid=${apiKey}&units=imperial&exclude=minutely,hourly,daily,alerts`;

    return new Promise((resolve, reject) => {
        const req = https.get(apiUrl, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                try {
                    const weatherData = JSON.parse(data);
                    if (res.statusCode !== 200 || !weatherData.current) {
                        console.error("OpenWeatherMap API Error:", weatherData);
                        resolve({
                            statusCode: res.statusCode,
                            body: JSON.stringify({ error: weatherData.message || 'Error fetching weather data.' }),
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

        req.setTimeout(10000, () => {
            req.destroy();
            console.error("Request timed out.");
            resolve({ statusCode: 504, body: JSON.stringify({ error: "Request timed out." }) });
        });

        req.end();
    });
};
