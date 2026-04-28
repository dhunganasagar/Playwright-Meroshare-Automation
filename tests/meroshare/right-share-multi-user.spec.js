const { test } = require('@playwright/test');
require('dotenv').config();
const {
  performLogin,
  isLoginSuccessful,
  clickMyASBA,
  checkForRightShareApplyButton,
  clickRightShareApplyButton,
  checkRightShareApplicationStatus,
  goBackToMyASBA,
  fillIPOApplication,
  submitIPOApplication,
  initBot,
  sendMessage,
  notifyError,
  navigateWithRetry,
  waitForElementWithRetry,
  retryWithBackoff,
} = require('./helpers');
const { users, telegram } = require('../../users.config');

test.describe('MeroShare Multi-User Right Share Automation', () => {
  test.setTimeout(600000); // 10 minutes total for all users

  test('should check for Right Share and auto-apply for all users', async ({ browser }) => {
    const telegramToken = telegram.token;
    const telegramChatId = telegram.chatId;

    if (telegramToken) {
      try {
        initBot(telegramToken);
        console.log('Telegram bot initialized successfully');
      } catch (error) {
        console.error('Failed to initialize Telegram bot:', error.message);
      }
    }

    if (!users || users.length === 0) {
      console.log('No valid users configured. Please check users.config.js');
      if (telegramChatId && telegramToken) {
        await notifyError(telegramChatId, 'No valid users configured for Right Share automation.');
      }
      return;
    }

    console.log(`Found ${users.length} valid user(s) to process`);

    const results = [];
    let cachedShareDetails = null;

    for (let i = 0; i < users.length; i++) {
      const user = users[i];
      const userLabel = user.name || `User ${i + 1}`;

      console.log(`\n========== Processing ${userLabel} (${i + 1}/${users.length}) ==========`);

      const context = await browser.newContext();
      const page = await context.newPage();

      let userResult = {
        user: userLabel,
        status: 'unknown',
        message: '',
        shareDetails: null,
      };

      try {
        const loginUrl = 'https://meroshare.cdsc.com.np/#/login';
        await navigateWithRetry(page, loginUrl, {
          maxRetries: 5,
          timeout: 120000,
          waitUntil: 'domcontentloaded',
        });

        try {
          await waitForElementWithRetry(page, [
            'form',
            'input#username',
            'select2#selectBranch',
            'input[type="text"]',
          ], {
            timeout: 60000,
            maxRetries: 3,
            reloadOnFail: true,
          });
        } catch (e) {
          console.log('Could not find login form elements, continuing anyway...');
          await page.waitForTimeout(2000);
        }

        // Login
        await retryWithBackoff(
          async () => {
            await performLogin(page, {
              username: user.username,
              password: user.password,
              dp: user.dp,
            });
          },
          {
            maxRetries: 3,
            initialDelay: 3000,
            onRetry: async (error, attempt) => {
              console.log(`${userLabel}: Login attempt ${attempt} failed: ${error.message}. Retrying...`);
              try {
                await page.reload({ timeout: 60000, waitUntil: 'domcontentloaded' });
                await page.waitForTimeout(2000);
              } catch (e) {
                console.log('Page reload failed, continuing...');
              }
            }
          }
        );

        await page.waitForTimeout(5000);

        const loginSuccess = await isLoginSuccessful(page);
        if (!loginSuccess) {
          throw new Error('Login failed');
        }

        console.log(`${userLabel}: Login successful`);

        // Navigate to My ASBA
        await retryWithBackoff(
          async () => {
            await clickMyASBA(page);
          },
          {
            maxRetries: 3,
            initialDelay: 2000,
          }
        );
        await page.waitForTimeout(5000);

        // Check for Right Share
        const applyInfo = await retryWithBackoff(
          async () => {
            const info = await checkForRightShareApplyButton(page);
            if (info.found || info.reason) {
              return info;
            }
            throw new Error('Page not fully loaded');
          },
          {
            maxRetries: 3,
            initialDelay: 3000,
          }
        );

        if (!applyInfo.found) {
          if (applyInfo.alreadyApplied) {
            console.log(`${userLabel}: Right Share already applied`);
            userResult.status = 'already_applied';
            userResult.message = 'Right Share already applied';
            userResult.shareDetails = applyInfo.shareDetails;
            cachedShareDetails = applyInfo.shareDetails;
          } else {
            console.log(`${userLabel}: No Right Share available`);
            userResult.status = 'no_right_share';
            userResult.message = 'No Right Share available';
          }
        } else {
          userResult.shareDetails = applyInfo.shareDetails;
          cachedShareDetails = applyInfo.shareDetails;

          if (!user.bank || !user.accountNumber || !user.kitta || !user.crn || !user.txnPin) {
            userResult.status = 'needs_review';
            userResult.message = 'Missing required credentials (bank, account, kitta, crn, or txnPin)';
            console.log(`${userLabel}: Missing credentials for auto-apply`);
          } else {
            // Set TXN PIN in env for this user (submitIPOApplication reads from env)
            process.env.MEROSHARE_TXN_PIN = user.txnPin;

            let submitResult = null;
            await retryWithBackoff(
              async () => {
                await clickRightShareApplyButton(page, applyInfo);
                await page.waitForTimeout(3000);

                await fillIPOApplication(page, {
                  bank: user.bank,
                  accountNumber: user.accountNumber,
                  kitta: user.kitta,
                  crn: user.crn,
                });
                await page.waitForTimeout(2000);

                submitResult = await submitIPOApplication(page);
                if (!submitResult.clickedApply) {
                  throw new Error(submitResult.error || 'Failed to submit Right Share application');
                }
                await page.waitForTimeout(3000);
              },
              {
                maxRetries: 2,
                initialDelay: 3000,
                onRetry: async (error, attempt) => {
                  console.log(`${userLabel}: Application attempt ${attempt} failed: ${error.message}. Retrying...`);
                  try {
                    await goBackToMyASBA(page);
                    await page.waitForTimeout(2000);
                  } catch (e) {}
                }
              }
            );

            await page.waitForTimeout(3000);

            if (!page.isClosed()) {
              const status = await checkRightShareApplicationStatus(page);
              if (status.success) {
                userResult.status = 'success';
                userResult.message = status.message || 'Application submitted';
                console.log(`${userLabel}: Right Share application submitted successfully!`);
              } else {
                userResult.status = 'failed';
                userResult.message = status.message || 'Application failed';
                console.log(`${userLabel}: Application failed - ${status.message}`);
              }
            } else {
              userResult.status = 'unknown';
              userResult.message = 'Page closed unexpectedly';
            }
          }
        }

      } catch (error) {
        console.error(`${userLabel}: Error - ${error.message}`);
        userResult.status = 'failed';
        userResult.message = error.message;
      } finally {
        await context.close();
      }

      results.push(userResult);

      if (i < users.length - 1) {
        console.log('Waiting before next user...');
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }

    // Send consolidated Telegram notification
    if (telegramChatId && telegramToken) {
      await sendRightShareMultiUserNotification(telegramChatId, results, cachedShareDetails, sendMessage);
    }

    // Log summary
    console.log('\n========== SUMMARY ==========');
    for (const result of results) {
      console.log(`${result.user}: ${result.status} - ${result.message}`);
    }

    // Fail test if any user failed
    const failures = results.filter(r => r.status === 'failed');
    if (failures.length > 0) {
      throw new Error(`${failures.length} user(s) failed: ${failures.map(f => f.user).join(', ')}`);
    }
  });
});

/**
 * Send consolidated multi-user Right Share notification to Telegram
 * @param {string} chatId - Telegram chat ID
 * @param {Array} results - Array of user results
 * @param {Object} shareDetails - Right Share details
 * @param {Function} sendMessageFn - sendMessage function from telegram helper
 */
async function sendRightShareMultiUserNotification(chatId, results, shareDetails, sendMessageFn) {
  const allNoShare = results.every(r => r.status === 'no_right_share');
  if (allNoShare) {
    const message = `ℹ️ *No Right Share Today* 🤦‍♀️\n\nChecked for ${results.length} user(s) - No Right Share available.`;
    await sendMessageFn(chatId, message, { parse_mode: 'Markdown' });
    return;
  }

  let message = '';

  if (shareDetails && shareDetails.companyName) {
    message += `🏢 *${shareDetails.companyName}*\n`;
    if (shareDetails.shareGroup) {
      message += `Share Group: ${shareDetails.shareGroup}\n`;
    }
    message += '\n';
  }

  const successUsers = results.filter(r => r.status === 'success');
  const alreadyAppliedUsers = results.filter(r => r.status === 'already_applied');
  const failedUsers = results.filter(r => r.status === 'failed');
  const reviewUsers = results.filter(r => r.status === 'needs_review');
  const unknownUsers = results.filter(r => r.status === 'unknown');

  if (successUsers.length > 0) {
    message += `✅ *Applied Successfully (${successUsers.length})*\n`;
    for (const user of successUsers) {
      message += `  • ${user.user}\n`;
    }
    message += '\n';
  }

  if (alreadyAppliedUsers.length > 0) {
    message += `✅ *Already Applied (${alreadyAppliedUsers.length})*\n`;
    for (const user of alreadyAppliedUsers) {
      message += `  • ${user.user}\n`;
    }
    message += '\n';
  }

  if (failedUsers.length > 0) {
    message += `❌ *Failed (${failedUsers.length})*\n`;
    for (const user of failedUsers) {
      message += `  • ${user.user}: ${user.message}\n`;
    }
    message += '\n';
  }

  if (reviewUsers.length > 0) {
    message += `⚠️ *Needs Manual Review (${reviewUsers.length})*\n`;
    for (const user of reviewUsers) {
      message += `  • ${user.user}: ${user.message}\n`;
    }
    message += '\n';
  }

  if (unknownUsers.length > 0) {
    message += `❓ *Status Unknown (${unknownUsers.length})*\n`;
    for (const user of unknownUsers) {
      message += `  • ${user.user}\n`;
    }
    message += '\n';
  }

  if (failedUsers.length > 0 || unknownUsers.length > 0 || reviewUsers.length > 0) {
    message += `\n⚠️ Please verify at meroshare.cdsc.com.np`;
  }
  message += `\n\n_Time: ${new Date().toLocaleString()}_`;

  await sendMessageFn(chatId, message, { parse_mode: 'Markdown' });
}
