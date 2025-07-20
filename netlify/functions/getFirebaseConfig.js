
exports.handler = async function(event, context) {
    // We will get these values from the Netlify environment variables you set up.
    const firebaseConfig = {
        apiKey: process.env.FIREBASE_API_KEY,
        authDomain: process.env.FIREBASE_AUTH_DOMAIN,
        projectId: process.env.FIREBASE_PROJECT_ID,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
        messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
        appId: process.env.FIREBASE_APP_ID,
    };

    // Check if all keys are present
    for (const key in firebaseConfig) {
        if (!firebaseConfig[key]) {
            return {
                statusCode: 500,
                body: JSON.stringify({ error: `Missing Firebase config for: ${key}` }),
            };
        }
    }

    // Success! Send the secure config object to the dashboard.
    return {
        statusCode: 200,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*', // Allow your website to call this
        },
        body: JSON.stringify(firebaseConfig),
    };
};
