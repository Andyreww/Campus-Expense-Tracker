// This is a Netlify serverless function for pre-launch signups.
import { Resend } from 'resend';

// Get the API key from your Netlify environment variables
const resend = new Resend(process.env.RESEND_API_KEY);

// Your verified sender email
const SENDER_EMAIL = 'Nooksii <welcome@nooksii.com>';

export const handler = async (event) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': event.headers?.origin || '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders };
  }
  // Only allow POST requests
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders, body: 'Method Not Allowed' };
  }

  try {
    // Accept JSON, form-encoded, or raw email strings; support base64 bodies
    const rawBody = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64').toString('utf8')
      : (event.body || '');
    let email = undefined;
    try {
      const parsed = JSON.parse(rawBody || '{}');
      email = parsed?.email;
    } catch (_) {
      // Not JSON; try form-encoded or raw
      const m = /email=([^&\s]+)/i.exec(rawBody);
      if (m) email = decodeURIComponent(m[1]);
      else if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(rawBody.trim())) email = rawBody.trim();
    }

  if (!email) {
      return { statusCode: 400, headers: corsHeaders, body: 'Email is required' };
    }

    console.log(`Sending pre-launch confirmation email to: ${email}`);

    // The actual email sending part
    const { data, error } = await resend.emails.send({
      from: SENDER_EMAIL,
      to: [email],
      subject: "You're on the list! ✅🦉",
      html: `
        <div style="background: #f7f7f7; padding: 40px; font-family: 'Nunito', 'Lato', sans-serif; text-align: center;">
          <div style="max-width: 600px; margin: auto; background: #fffdf7; border-radius: 16px; box-shadow: 0 8px 32px rgba(76,175,80,0.08); padding: 32px 24px;">
            <div style="margin-bottom: 18px;">
              <div style="font-size: 2.8rem; margin-bottom: 8px;">🦉⏳</div>
              <div style="font-family: 'Fredoka One', cursive; font-size: 2.3rem; color: #4A2C2A; letter-spacing: 0.02em; margin-bottom: 2px;">Nooksii</div>
              <h1 style="color: #4A2C2A; font-size: 2.1rem; margin: 0; font-family: 'Patrick Hand', cursive; font-weight: 400;">You're In! (Almost)</h1>
              <p style="color: #856f6f; font-size: 1.1rem; margin-top: 8px;">Your spot is reserved. Cozy up, launch day is coming!</p>
            </div>
            <div style="margin: 32px 0;">
              <div style="background: #f0ead6; border-radius: 8px; padding: 18px 12px;">
                <p style="font-size: 1.15rem; color: #4A2C2A; margin: 0 0 10px 0;">Thanks for signing up for Nooksii! We're putting the finishing touches on your new campus hub.</p>
                <div style="margin: 18px 0;">
                  <span style="display: inline-block; background: #4caf50; color: #fff; font-weight: bold; border-radius: 999px; padding: 8px 22px; font-size: 1.1rem; letter-spacing: 0.03em;">Launches August 20th</span>
                </div>
                <div style="margin: 18px 0;">
                  <div style="width: 100%; background: #ded0b6; border-radius: 8px; height: 28px; position: relative; box-shadow: 0 2px 8px rgba(76,175,80,0.10);">
                    <div style="width: 80%; background: linear-gradient(90deg,#4caf50 60%,#45a049 100%); height: 100%; border-radius: 8px; box-shadow: 0 4px 12px rgba(76,175,80,0.18); position: absolute; left: 0; top: 0;"></div>
                    <span style="position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%); color: #4A2C2A; font-size: 1.05rem; font-family: 'Fredoka One', cursive; font-weight: 700; letter-spacing: 0.03em;">Almost There!</span>
                  </div>
                </div>
                <p style="font-size: 1rem; color: #856f6f; margin: 18px 0 0 0;">We'll send you a cozy invite as soon as your Nook is ready. Until then, keep an eye on your inbox!</p>
              </div>
            </div>
            <a href="https://nooksii.com" style="display: inline-block; margin-top: 18px; background: linear-gradient(180deg,#4caf50 0%,#45a049 100%); color: #fff; text-decoration: none; font-family: 'Fredoka One', cursive; font-weight: 700; padding: 14px 36px; border-radius: 50px; font-size: 1.18rem; box-shadow: 0 6px 18px rgba(76,175,80,0.18), 0 2px 8px rgba(76,175,80,0.12); border-bottom: 5px solid #388E3C; letter-spacing: 0.04em; transition: background 0.2s;">Stay Tuned</a>
            <div style="margin-top: 32px; color: #aaa; font-size: 0.95rem;">
              <span style="font-size: 1.2rem;">🦉</span> The Nooksii Team
            </div>
          </div>
        </div>
      `,
    });

    if (error) {
      console.error({ error });
      return { statusCode: 500, headers: corsHeaders, body: JSON.stringify(error) };
    }

    console.log('Pre-launch email sent successfully:', data);
    return { statusCode: 200, headers: corsHeaders, body: 'Email sent successfully' };

  } catch (error) {
    console.error('An unexpected error occurred:', error);
    return { statusCode: 500, headers: corsHeaders, body: `Error: ${error.message}` };
  }
};
