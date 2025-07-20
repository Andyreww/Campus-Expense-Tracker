// This is our serverless function, our "middleman"
// It runs on Netlify's servers, not in the user's browser.

exports.handler = async function(event, context) {
    const { university } = event.queryStringParameters;
    
    // --- TEMPORARY DEBUGGING STEP ---
    // Paste your actual OpenWeatherMap API key here inside the quotes.
    // We're bypassing the Netlify environment variable for a moment to test.
    const apiKey = "c517f9dc759d99b1a01932217e12cd2b";

    // We'll switch back to this line later once we solve the issue:
    // const apiKey = process.env.OPENWEATHERMAP_API_KEY; 

    // --- BETTER ERROR CHECKING ---
    if (!university) {
        console.error("Function Error: University parameter was not provided.");
        return {
            statusCode: 400,
            body: JSON.stringify({ error: 'University parameter is missing' }),
        };
    }
    // New check to make sure you pasted the key
    if (!apiKey || apiKey === "PASTE_YOUR_KEY_HERE") {
        console.error("DEBUG Error: API Key is not pasted into the function file.");
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'API key is missing from the function file for debugging.' }),
        };
    }

    const apiUrl = `https://api.openweathermap.org/data/2.5/weather?q=${university}&appid=${apiKey}&units=imperial`;

    try {
        const fetch = (await import('node-fetch')).default;
        const response = await fetch(apiUrl);
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
