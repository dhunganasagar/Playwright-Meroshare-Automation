const { test } = require('@playwright/test');
require('dotenv').config();
const {
  performLogin,
  isLoginSuccessful,
  clickMyASBA,
  checkForRightShareApplyButton,
  clickRightShareApplyButton,
  clickRightShareRow,
  checkRightShareApplicationStatus,
  goBackToMyASBA,
  fillIPOApplication,
  submitIPOApplication,
  initBot,
  notifyIPOStatus,
  notifyError,
  navigateWithRetry,
  waitForElementWithRetry,
  retryWithBackoff,
} = require('./helpers');

test.describe('MeroShare Right Share Automation', () => {
  test.setTimeout(300000); // 5 minutes

  test.beforeEach(async ({ page }) => {
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
  });

  test('should check for Right Share and auto-apply', async ({ page }) => {
    const username = process.env.MEROSHARE_USERNAME;
    const password = process.env.MEROSHARE_PASSWORD;
    const dp = process.env.MEROSHARE_DP_NP;
    const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
    const telegramChatId = process.env.TELEGRAM_CHAT_ID;
    const bank = process.env.MEROSHARE_BANK;
    const accountNumber = process.env.MEROSHARE_P_ACCOUNT_NO;
    const kitta = process.env.MEROSHARE_KITTA_N0;
    const crn = process.env.MEROSHARE_CRN_NO;

    if (!username || !password) {
      throw new Error('MEROSHARE_USERNAME and MEROSHARE_PASSWORD must be set in .env file');
    }

    if (telegramToken) {
      try {
        initBot(telegramToken);
        console.log('Telegram bot initialized successfully');
      } catch (error) {
        console.error('Failed to initialize Telegram bot:', error.message);
      }
    }

    let shareDetails = null;
    let finalStatus = 'no_right_share';
    let failureReason = '';

    try {
      try {
        await waitForElementWithRetry(page, [
          'form',
          'input#username',
          'select2#selectBranch',
        ], { timeout: 30000, maxRetries: 2 });
      } catch (e) {
        console.log('Login form elements not found, attempting to continue...');
      }
      await page.waitForTimeout(1000);

      // Login with retry
      await retryWithBackoff(
        async () => {
          await performLogin(page, { username, password, dp });
        },
        {
          maxRetries: 3,
          initialDelay: 3000,
          onRetry: async (error, attempt) => {
            console.log(`Login attempt ${attempt} failed: ${error.message}. Retrying...`);
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

      const success = await isLoginSuccessful(page);
      if (!success) {
        let errorMessage = 'Login failed';
        const errorText = await page.locator('.error, .alert-danger, [role="alert"]').first().textContent().catch(() => null);
        if (errorText) {
          errorMessage = `Login failed: ${errorText.trim()}`;
        }

        try {
          await page.locator('input[type="password"], input[name*="password" i]').evaluate(el => el.value = '');
          await page.locator('input[name*="username" i], input[id*="username" i]').evaluate(el => el.value = '');
        } catch (e) {}

        throw new Error(errorMessage);
      }

      // Navigate to My ASBA
      await retryWithBackoff(
        async () => {
          await clickMyASBA(page);
        },
        {
          maxRetries: 3,
          initialDelay: 2000,
          onRetry: (error, attempt) => {
            console.log(`My ASBA click attempt ${attempt} failed. Retrying...`);
          }
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
          onRetry: async (error, attempt) => {
            console.log(`Right Share check attempt ${attempt} - page may still be loading...`);
            await page.waitForTimeout(2000);
          }
        }
      );

      if (!applyInfo.found) {
        if (applyInfo.alreadyApplied) {
          console.log('Right Share already applied for this account.');
          finalStatus = 'already_applied';
          shareDetails = applyInfo.shareDetails;
        } else {
          console.log('No Right Share available for application.');
          finalStatus = 'no_right_share';
        }
      } else {
        shareDetails = applyInfo.shareDetails;

        // Only auto-apply if all required env vars are set
        if (!bank || !accountNumber || !kitta || !crn) {
          console.log('Auto-apply disabled: Missing required environment variables (MEROSHARE_BANK, MEROSHARE_P_ACCOUNT_NO, MEROSHARE_KITTA_N0, MEROSHARE_CRN_NO)');
          finalStatus = 'needs_review';
          failureReason = 'Auto-apply not configured. Please apply manually.';
        } else {
          // Fill and submit application with retry
          let submitResult = null;
          await retryWithBackoff(
            async () => {
              await clickRightShareApplyButton(page, applyInfo);
              await page.waitForTimeout(3000);

              await fillIPOApplication(page, {
                bank,
                accountNumber,
                kitta,
                crn,
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
                console.log(`Right Share application attempt ${attempt} failed: ${error.message}. Retrying...`);
                try {
                  await goBackToMyASBA(page);
                  await page.waitForTimeout(2000);
                } catch (e) {
                  console.log('Could not go back, continuing...');
                }
              }
            }
          );

          await page.waitForTimeout(3000);

          if (!page.isClosed()) {
            const status = await checkRightShareApplicationStatus(page);
            if (status.success) {
              finalStatus = 'success';
              console.log('Right Share application submitted successfully!');
            } else {
              finalStatus = 'failed';
              failureReason = status.message || 'Application submission failed - please verify manually';
            }
          } else {
            finalStatus = 'unknown';
            failureReason = 'Page closed unexpectedly. Please verify application status manually.';
          }
        }
      }

    } catch (error) {
      console.error(`Error during Right Share automation: ${error.message}`);
      finalStatus = 'failed';
      failureReason = error.message;

      if (error.message && error.message.includes('Target page, context or browser has been closed')) {
        finalStatus = 'unknown';
        failureReason = 'Page closed unexpectedly. Right Share may or may not have been submitted.';
      }
    }

    // Send Telegram notification
    if (telegramChatId && telegramToken) {
      try {
        const companyName = shareDetails?.companyName || 'Right Share';

        switch (finalStatus) {
          case 'success':
            await notifyIPOStatus(
              telegramChatId,
              'success',
              `✅ ${companyName} Right Share application submitted successfully!`
            );
            break;

          case 'failed':
            await notifyError(
              telegramChatId,
              `❌ Failed to auto-apply for Right Share.\n\n` +
              `Please apply manually at https://meroshare.cdsc.com.np\n\n` +
              `We apologize for the inconvenience.`
            );
            break;

          case 'needs_review':
            await notifyError(
              telegramChatId,
              `⚠️ Right Share available but not auto-applied.\n\n` +
              `*Company:* ${companyName}\n` +
              `*Reason:* ${failureReason}\n\n` +
              `Please apply manually at https://meroshare.cdsc.com.np`
            );
            break;

          case 'unknown':
            await notifyError(
              telegramChatId,
              `⚠️ Right Share application status unknown.\n\n` +
              `${failureReason}\n\n` +
              `Please check your MeroShare account to verify if the application was submitted.`
            );
            break;

          case 'already_applied':
            await notifyIPOStatus(
              telegramChatId,
              'success',
              `✅ ${companyName} Right Share already applied!\n\nYour application was previously submitted.`
            );
            break;

          case 'no_right_share':
            await notifyError(
              telegramChatId,
              `ℹ️ No Right Share available today.`
            );
            break;
        }
      } catch (notificationError) {
        console.error(`Failed to send Telegram notification: ${notificationError.message}`);
      }
    }

    if (finalStatus === 'failed') {
      throw new Error(failureReason);
    }
  });
});
