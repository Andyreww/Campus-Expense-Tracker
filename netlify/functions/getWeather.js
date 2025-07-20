exports.handler = async function(event, context) {
    // Get the university name from the request, which our dashboard.js will send
    const { university } = event.queryStringParameters;
    
    // Your secret API key is stored in Netlify's system, not in your code.
    // We access it like this. It's much safer!
    const apiKey = process.env.OPENWEATHERMAP_API_KEY;

    // If the university name or API key is missing, we can't proceed.
    if (!university) {
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'University parameter is missing' }),
        };
    }
    if (!apiKey) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'API key is not configured' }),
        };
    }

    const apiUrl = `https://api.openweathermap.org/data/2.5/weather?q=${university}&appid=${apiKey}&units=imperial`;

    try {
        // We use 'node-fetch' which is available in Netlify functions
        const fetch = (await import('node-fetch')).default;
        const response = await fetch(apiUrl);
        const data = await response.json();

        // If the weather API gives an error (e.g., city not found), pass it along
        if (!response.ok) {
            return {
                statusCode: data.cod || 500,
                body: JSON.stringify(data),
            };
        }

        // Success! Send the weather data back to the dashboard.
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*', // Allow our website to call this function
            },
            body: JSON.stringify(data),
        };
    } catch (error) {
        // Catch any other network errors
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to fetch weather data' }),
        };
    }
};
