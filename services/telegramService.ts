/**
 * Telegram Notification Service
 * 
 * INSTRUCTIONS:
 * 1. Replace 'YOUR_BOT_TOKEN_HERE' with the token from @BotFather.
 * 2. Replace 'YOUR_CHAT_ID_HERE' with your ID from @userinfobot.
 * 3. Make sure you have sent a "Hello" message to your bot in Telegram first!
 */

const BOT_TOKEN = '8215277484:AAGzAzovToD9_YRRCIH6HXo_w1_DDhP8G1g'; 
// Add multiple Chat IDs here. Each user must start a chat with the bot first!
const CHAT_IDS = [
  '8403312728', // Main Admin
  '7053968926', // Hadi
  '8278128907', // Yahia
];

export const TelegramService = {
  /**
   * Sends a message to all configured Telegram Chats.
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
    
    // Send to all users in parallel
    const promises = CHAT_IDS.map(async (chatId) => {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            chat_id: chatId,
            text: message,
            parse_mode: 'HTML' // Allows bold/italic text
          })
        });

        if (!response.ok) {
          const errorData = await response.json();
          console.error(`Telegram API Error (${chatId}):`, errorData);
          // Alert the user if a specific ID fails (helps debug blocks/bans)
          alert(`Failed to send to ${chatId === '8403312728' ? 'Main Admin' : 'User ' + chatId}:\n${errorData.description}`);
          return false;
        }
        return true;
      } catch (error) {
        console.error(`Failed to send Telegram message to ${chatId}:`, error);
        return false;
      }
    });

    const results = await Promise.all(promises);
    // Return true if at least one message was sent successfully
    return results.some(result => result === true);
  }
};
