// This is a Netlify serverless function for pre-launch signups.
import { Resend } from 'resend';

// Get the API key from your Netlify environment variables
const resend = new Resend(process.env.RESEND_API_KEY);

// Your verified sender email
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

    console.log(`Sending pre-launch confirmation email to: ${email}`);

    // The actual email sending part
    const { data, error } = await resend.emails.send({
      from: SENDER_EMAIL,
      to: [email],
      subject: "You're on the list! ✅🦉",
      html: `
        <div style="font-family: sans-serif; line-height: 1.6;">
          <h1 style="color: #4A2C2A;">You're In! (Almost)</h1>
          <p>Hey!</p>
          <p>Thanks for signing up for Nooksii! You've successfully reserved your spot. We're putting the finishing touches on everything to make it perfect.</p>
          <p>Your Nook will be ready for you on <strong>August 20th</strong>. Until then, just hang tight!</p>
          <p>We can't wait to see you there,</p>
          <p>– The Nooksii Team</p>
        </div>
      `,
    });

    if (error) {
      console.error({ error });
      return { statusCode: 500, body: JSON.stringify(error) };
    }

    console.log('Pre-launch email sent successfully:', data);
    return { statusCode: 200, body: 'Email sent successfully' };

  } catch (error) {
    console.error('An unexpected error occurred:', error);
    return { statusCode: 500, body: `Error: ${error.message}` };
  }
};
