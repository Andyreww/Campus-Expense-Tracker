const fetch = require('node-fetch');

exports.handler = async function(event, context) {
    const { university } = event.queryStringParameters;
    
    const apiKey = process.env.OPENWEATHERMAP_API_KEY; 

    // --- ERROR CHECKING ---
    if (!university) {
        console.error("Function Error: University parameter was not provided.");
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'University parameter is missing' }),
        };
    }
    if (!apiKey) {
        console.error("Function Error: OPENWEATHERMAP_API_KEY is missing from Netlify environment variables.");
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'API key is not configured on the server.' }),
        };
    }

    const apiUrl = `https://api.openweathermap.org/data/2.5/weather?q=${university}&appid=${apiKey}&units=imperial`;

    try {
        // We added a 10-second timeout to be more patient with the network
        const response = await fetch(apiUrl, { timeout: 10000 });
        const data = await response.json();

        if (!response.ok) {
            console.error("OpenWeatherMap API Error:", data);
            return {
                statusCode: data.cod || 500,
                body: JSON.stringify(data),
            };
        }

        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
            body: JSON.stringify(data),
        };
    } catch (error) {
        console.error("General Fetch Error:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to fetch weather data' }),
        };
    }
};