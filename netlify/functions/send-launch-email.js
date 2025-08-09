// This is a Netlify serverless function.
// It uses the Resend service to send emails.

// Make sure to install Resend: npm install resend
import { Resend } from 'resend';

// IMPORTANT: Set your Resend API key in your Netlify environment variables.
// Name the variable: RESEND_API_KEY
const resend = new Resend(process.env.RESEND_API_KEY);

// You also need to verify a domain with Resend to send from it.
// Replace 'welcome@yourdomain.com' with your verified sender email.
const SENDER_EMAIL = 'Nooksii <welcome@nooksii.com>';

export const handler = async (event) => {
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { email } = JSON.parse(event.body);

    if (!email) {
      return { statusCode: 400, body: 'Email is required' };
    }

    console.log(`Sending launch email to: ${email}`);

    // The actual email sending part
    const { data, error } = await resend.emails.send({
      from: SENDER_EMAIL,
      to: [email],
      subject: 'Your Nook Has Arrived! ✨🦉',
      html: `
        <div style="font-family: sans-serif; line-height: 1.6;">
          <h1 style="color: #4A2C2A;">The wait is over!</h1>
          <p>Hey!</p>
          <p>Your Nook is officially ready for you. Thanks so much for waiting—we're so excited to finally have you.</p>
          <p>You can log in now and start getting your campus life organized.</p>
          <a 
            href="https://nooksii.com/login" 
            style="display: inline-block; padding: 12px 24px; background-color: #4CAF50; color: white; text-decoration: none; border-radius: 50px; font-weight: bold;"
          >
            Go to my Nook
          </a>
          <p>See you in there!</p>
          <p>– The Nooksii Team</p>
        </div>
      `,
    });

    if (error) {
      console.error({ error });
      return { statusCode: 500, body: JSON.stringify(error) };
    }

    console.log('Email sent successfully:', data);
    return { statusCode: 200, body: 'Email sent successfully' };

  } catch (error) {
    console.error('An unexpected error occurred:', error);
    return { statusCode: 500, body: `Error: ${error.message}` };
  }
};
