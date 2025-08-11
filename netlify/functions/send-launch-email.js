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
        <div style="background: #f7f7f7; padding: 40px; font-family: 'Nunito', 'Lato', sans-serif; text-align: center;">
          <div style="max-width: 600px; margin: auto; background: #fffdf7; border-radius: 16px; box-shadow: 0 8px 32px rgba(76,175,80,0.08); padding: 32px 24px;">
            <div style="margin-bottom: 18px;">
              <div style="font-size: 2.8rem; margin-bottom: 8px;">✨🦉</div>
              <div style="font-family: 'Fredoka One', cursive; font-size: 2.3rem; color: #4A2C2A; letter-spacing: 0.02em; margin-bottom: 2px;">Nooksii</div>
              <h1 style="color: #4A2C2A; font-size: 2.1rem; margin: 0; font-family: 'Patrick Hand', cursive; font-weight: 400;">The wait is over!</h1>
              <p style="color: #856f6f; font-size: 1.1rem; margin-top: 8px;">Your Nook is ready. Let’s get started!</p>
            </div>
            <div style="margin: 32px 0;">
              <div style="background: #f0ead6; border-radius: 8px; padding: 18px 12px;">
                <p style="font-size: 1.15rem; color: #4A2C2A; margin: 0 0 10px 0;">Welcome to Nooksii! Your dashboard is now open and waiting for you.</p>
                <div style="margin: 18px 0;">
                  <span style="display: inline-block; background: #4caf50; color: #fff; font-weight: bold; border-radius: 999px; padding: 8px 22px; font-size: 1.1rem; letter-spacing: 0.03em;">Log in & start tracking</span>
                </div>
                <p style="font-size: 1rem; color: #856f6f; margin: 18px 0 0 0;">Organize your campus life, manage your balance, and enjoy a stress-free semester.</p>
              </div>
            </div>
            <a href="https://nooksii.com/dashboard" style="display: inline-block; margin-top: 18px; background: linear-gradient(180deg,#4caf50 0%,#45a049 100%); color: #fff; text-decoration: none; font-family: 'Fredoka One', cursive; font-weight: 700; padding: 14px 36px; border-radius: 50px; font-size: 1.18rem; box-shadow: 0 6px 18px rgba(76,175,80,0.18), 0 2px 8px rgba(76,175,80,0.12); border-bottom: 5px solid #388E3C; letter-spacing: 0.04em; transition: background 0.2s;">Go to Your Nook</a>
            <div style="margin-top: 32px; color: #aaa; font-size: 0.95rem;">
              <span style="font-size: 1.2rem;">🦉</span> The Nooksii Team
            </div>
          </div>
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
