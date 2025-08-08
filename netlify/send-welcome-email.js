// Import the Resend library
import { Resend } from 'resend';

// Initialize Resend with your API key
// Netlify will automatically grab this from your environment variables
const resend = new Resend(process.env.RESEND_API_KEY);

// This is the main function Netlify will run
exports.handler = async (event) => {
  // We only want to handle POST requests from our frontend
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    // Get the user's email that we sent from the frontend
    const { email } = JSON.parse(event.body);

    // Make sure we actually got an email
    if (!email) {
      return { statusCode: 400, body: 'Email is required.' };
    }

    // This is where the magic happens. Tell Resend to send the email.
    await resend.emails.send({
      from: 'Nooksii <welcome@nooksii.com>', // IMPORTANT: See note below
      to: email,
      subject: 'Welcome to Your Cozy Nook! 🦉',
      html: `
        <div style="font-family: sans-serif; text-align: center; background-color: #f7f7f7; padding: 40px;">
          <div style="max-width: 600px; margin: auto; background-color: white; padding: 20px; border-radius: 10px;">
            <h1 style="color: #4a4a4a;">Welcome to Nooksii!</h1>
            <p style="font-size: 16px; color: #555;">Hey there,</p>
            <p style="font-size: 16px; color: #555;">Thanks for signing up! We're stoked to have you. Your Nooksii dashboard is all set up and ready for you to start tracking your campus expenses.</p>
            <p style="font-size: 16px; color: #555;">Get ready to take control of your budget and have a stress-free semester.</p>
            <a href="https://[YOUR-NOOKSII-URL.com]" style="display: inline-block; padding: 12px 24px; margin-top: 20px; background-color: #5cb85c; color: white; text-decoration: none; border-radius: 5px; font-weight: bold;">Go to Your Nook</a>
            <p style="font-size: 14px; color: #aaa; margin-top: 30px;">- The Nooksii Team</p>
          </div>
        </div>
      `,
    });

    // Send a success message back to our frontend
    return {
      statusCode: 200,
      body: JSON.stringify({ message: 'Welcome email sent!' }),
    };
  } catch (error) {
    // If anything goes wrong, log the error and send back an error message
    console.error(error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Failed to send email.' }),
    };
  }
};