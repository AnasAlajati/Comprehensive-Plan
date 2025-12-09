/**
 * Telegram Notification Service
 * 
 * INSTRUCTIONS:
 * 1. Replace 'YOUR_BOT_TOKEN_HERE' with the token from @BotFather.
 * 2. Replace 'YOUR_CHAT_ID_HERE' with your ID from @userinfobot.
 * 3. Make sure you have sent a "Hello" message to your bot in Telegram first!
 */

const BOT_TOKEN = '8527491181:AAEpbfxewnQjTzxp5U5IHazie5Qw7TRaKhg'; 
const CHAT_ID = '8403312728';

export const TelegramService = {
  /**
   * Sends a message to your Telegram Chat.
   * @param message The text to send
   */
  send: async (message: string) => {
    // Safety check for placeholders
    if (BOT_TOKEN.includes('YOUR_BOT_TOKEN')) {
      console.warn("⚠️ Telegram Token is missing! Check services/telegramService.ts");
      alert("Please set your Telegram Bot Token in services/telegramService.ts");
      return false;
    }

    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: CHAT_ID,
          text: message,
          parse_mode: 'HTML' // Allows bold/italic text
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error("Telegram API Error:", errorData);
        throw new Error(`Telegram Error: ${errorData.description}`);
      }

      return true;
    } catch (error) {
      console.error("Failed to send Telegram message:", error);
      return false;
    }
  }
};
