// Import the Resend library
import { Resend } from 'resend';

// Initialize Resend with your API key
const resend = new Resend(process.env.RESEND_API_KEY);

// This is the main function Netlify will run
exports.handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': event.headers?.origin || '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders };
  }
  // We only want to handle POST requests
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: 'Method Not Allowed' };
  }

  // Get the user's email from the request
  // Accept JSON, form-encoded, or raw email strings; support base64 bodies
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');
  let email = undefined;
  try {
    const parsed = JSON.parse(rawBody || '{}');
    email = parsed?.email;
  } catch (_) {
    const m = /email=([^&\s]+)/i.exec(rawBody);
    if (m) email = decodeURIComponent(m[1]);
    else if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(rawBody.trim())) email = rawBody.trim();
  }

  // Make sure we actually got an email
  if (!email) {
    return { statusCode: 400, headers: corsHeaders, body: 'Email is required.' };
  }

  // --- NEW, MORE DETAILED TRY...CATCH BLOCK ---
  try {
    console.log(`Attempting to send email to: ${email}`);
    
    // We try to send the email and store the response
    const { data, error } = await resend.emails.send({
      from: 'Nooksii <welcome@nooksii.com>',
      to: email,
      subject: 'Welcome to Your Cozy Nook! 🦉',
      html: `
        <div style="font-family: sans-serif; text-align: center; background-color: #f7f7f7; padding: 40px;">
          <div style="max-width: 600px; margin: auto; background-color: white; padding: 20px; border-radius: 10px;">
            <h1 style="color: #4a4a4a;">Welcome to Nooksii!</h1>
            <p style="font-size: 16px; color: #555;">Hey there,</p>
            <p style="font-size: 16px; color: #555;">Thanks for signing up! We're stoked to have you. Your Nooksii dashboard is all set up and ready for you to start tracking your campus expenses.</p>
            <p style="font-size: 16px; color: #555;">Get ready to take control of your budget and have a stress-free semester.</p>
            <a href="https://nooksii.com/dashboard" style="display: inline-block; padding: 12px 24px; margin-top: 20px; background-color: #5cb85c; color: white; text-decoration: none; border-radius: 5px; font-weight: bold;">Go to Your Nook</a>
            <p style="font-size: 14px; color: #aaa; margin-top: 30px;">- The Nooksii Team</p>
          </div>
        </div>
      `,
    });

    // If Resend gives us an error, we log it in detail
    if (error) {
      console.error('Error from Resend:', error);
      return { statusCode: 400, headers: corsHeaders, body: JSON.stringify(error) };
    }

    // If it works, we log the success data
    console.log('Email sent successfully! Resend ID:', data.id);
  return { statusCode: 200, headers: corsHeaders, body: JSON.stringify(data) };

  } catch (error) {
    // This will catch any other general errors
    console.error('A general error occurred:', error);
  return { statusCode: 500, headers: corsHeaders, body: JSON.stringify({ message: 'Something went wrong.' }) };
  }
};
