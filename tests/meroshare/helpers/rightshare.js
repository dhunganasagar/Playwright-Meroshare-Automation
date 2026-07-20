/**
 * Right Share application helper functions
 */

const { waitForPageReady } = require('./common');

const RIGHT_SHARE_PATTERN = /right\s+share/i;

/**
 * Check if "Apply" button exists on My ASBA page for a Right Share issue
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @returns {Promise<{found: boolean, element?: any, text?: string, shareDetails?: object, rowElement?: any, alreadyApplied?: boolean, reason?: string}>}
 */
async function checkForRightShareApplyButton(page) {
  await page.waitForTimeout(3000);

  try {
    await waitForPageReady(page, [
      'body',
      'table',
      '.table',
      '[class*="asba" i]',
      '.company-list'
    ], 30000);
  } catch (e) {
    console.log('Page ready wait timed out, continuing to check for elements...');
  }

  try {
    const pageContent = await page.textContent('body');
    if (pageContent && /No Record/i.test(pageContent)) {
      return { found: false, reason: 'No Record(s) Found' };
    }
  } catch (e) {}

  try {
    const noRecordSelectors = [
      '*:has-text("No Record")',
      '*:has-text("No Record(s) Found")',
      'text=/No Record/i',
    ];

    for (const selector of noRecordSelectors) {
      try {
        const element = page.locator(selector).first();
        if (await element.isVisible({ timeout: 2000 })) {
          return { found: false, reason: 'No Record(s) Found' };
        }
      } catch (e) {
        continue;
      }
    }
  } catch (e) {}

  try {
    const companyRows = await page.locator('div.company-list').all();

    let alreadyAppliedShares = [];

    for (const row of companyRows) {
      try {
        const rowText = await row.textContent({ timeout: 2000 });

        // Only process rows containing "Right Share"
        if (!RIGHT_SHARE_PATTERN.test(rowText)) {
          continue;
        }

        let companyName = '';
        let subGroup = '';
        let shareType = '';
        let shareGroup = 'Right Share';

        try {
          const companySpan = await row.locator('span[tooltip="Company Name"]').first().textContent({ timeout: 1000 });
          companyName = companySpan.trim();
        } catch (e) {}

        try {
          const subGroupSpan = await row.locator('span[tooltip="Sub Group"]').first().textContent({ timeout: 1000 });
          subGroup = subGroupSpan.trim();
        } catch (e) {}

        try {
          const shareTypeSpan = await row.locator('span[tooltip="Share Type"]').first().textContent({ timeout: 1000 });
          shareType = shareTypeSpan.trim();
        } catch (e) {}

        try {
          const shareGroupSpan = await row.locator('span[tooltip="Share Group"]').first().textContent({ timeout: 1000 });
          shareGroup = shareGroupSpan.trim();
        } catch (e) {}

        const shareDetails = {
          companyName,
          subGroup,
          shareType,
          shareGroup,
        };

        const applyButton = row.locator('button:has-text("Apply")').first();

        if (await applyButton.isVisible({ timeout: 2000 })) {
          return {
            found: true,
            element: applyButton,
            rowElement: row,
            text: 'Apply',
            alreadyApplied: false,
            shareDetails,
          };
        }

        const editButton = row.locator('button:has-text("Edit")').first();

        if (await editButton.isVisible({ timeout: 1000 })) {
          alreadyAppliedShares.push({ companyName, shareDetails });
        }

      } catch (e) {
        continue;
      }
    }

    if (alreadyAppliedShares.length > 0) {
      return {
        found: false,
        alreadyApplied: true,
        reason: 'Right Share already applied',
        appliedShares: alreadyAppliedShares,
        shareDetails: alreadyAppliedShares[0].shareDetails,
      };
    }

    // Fallback: try table rows
    if (companyRows.length === 0) {
      const tableRows = await page.locator('table tr, .table tr').all();

      for (const row of tableRows) {
        try {
          const rowHTML = await row.innerHTML({ timeout: 1000 });

          if (!RIGHT_SHARE_PATTERN.test(rowHTML)) {
            continue;
          }

          const applyButton = row.locator('button:has-text("Apply"), a:has-text("Apply")').first();

          if (await applyButton.isVisible({ timeout: 1000 })) {
            return {
              found: true,
              element: applyButton,
              rowElement: row,
              text: 'Apply',
              alreadyApplied: false,
              shareDetails: {
                companyName: '',
                subGroup: '',
                shareType: '',
                shareGroup: 'Right Share',
              },
            };
          }

          const editButton = row.locator('button:has-text("Edit"), a:has-text("Edit")').first();

          if (await editButton.isVisible({ timeout: 1000 })) {
            return {
              found: false,
              alreadyApplied: true,
              reason: 'Right Share already applied',
              shareDetails: {
                companyName: '',
                subGroup: '',
                shareType: '',
                shareGroup: 'Right Share',
              },
            };
          }
        } catch (e) {
          continue;
        }
      }
    }

    return { found: false, alreadyApplied: false, reason: 'No Right Share available' };

  } catch (e) {
    return { found: false, alreadyApplied: false, reason: 'Error checking page' };
  }
}

/**
 * Click Apply button on ASBA page for Right Share
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {Object} applyInfo - Apply button information from checkForRightShareApplyButton
 */
async function clickRightShareApplyButton(page, applyInfo) {
  if (!applyInfo.found || !applyInfo.element) {
    throw new Error('Right Share Apply button not found or element not available');
  }

  try {
    await applyInfo.element.click();
    await page.waitForTimeout(2000);
  } catch (e) {
    const element = page.locator('button:has-text("Apply"), a:has-text("Apply")').first();
    if (await element.isVisible({ timeout: 3000 })) {
      await element.click();
      await page.waitForTimeout(2000);
    } else {
      throw new Error('Could not click Right Share Apply button');
    }
  }
}

/**
 * Click on the Right Share row to view details
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @param {Object} applyInfo - Apply button information from checkForRightShareApplyButton
 * @returns {Promise<boolean>}
 */
async function clickRightShareRow(page, applyInfo) {
  try {
    if (applyInfo.rowElement) {
      const companyNameSpan = applyInfo.rowElement.locator('span[tooltip="Company Name"]').first();
      if (await companyNameSpan.isVisible({ timeout: 2000 })) {
        await companyNameSpan.click();
      } else {
        await applyInfo.rowElement.locator('div.company-name').first().click();
      }
    } else {
      throw new Error('Row element not available');
    }

    await page.waitForTimeout(3000);
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Check application status after Right Share submission
 * @param {import('@playwright/test').Page} page - Playwright page object
 * @returns {Promise<{success: boolean, message?: string}>}
 */
async function checkRightShareApplicationStatus(page) {
  await page.waitForTimeout(3000);

  let pageContent = '';
  try {
    pageContent = await page.textContent('body');
  } catch (e) {
    pageContent = '';
  }

  const successPatterns = [
    /right\s+share\s+(has\s+been\s+)?applied\s+successfully/i,
    /application\s+(has\s+been\s+)?submitted\s+successfully/i,
    /successfully\s+applied/i,
    /your\s+application\s+has\s+been\s+submitted/i,
    /application\s+successful/i,
  ];

  for (const pattern of successPatterns) {
    if (pattern.test(pageContent)) {
      return {
        success: true,
        message: pageContent.match(pattern)?.[0] || 'Right Share application submitted successfully',
      };
    }
  }

  const failurePatterns = [
    /application\s+failed/i,
    /could\s+not\s+apply/i,
    /error\s+occurred/i,
    /already\s+applied/i,
    /duplicate\s+application/i,
  ];

  for (const pattern of failurePatterns) {
    if (pattern.test(pageContent)) {
      return {
        success: false,
        message: pageContent.match(pattern)?.[0] || 'Application may have failed',
      };
    }
  }

  // Check for success indicators in DOM
  try {
    const successSelectors = [
      '.success',
      '.alert-success',
      '[class*="success" i]',
      'text=/successfully/i',
    ];

    for (const selector of successSelectors) {
      try {
        const element = page.locator(selector).first();
        if (await element.isVisible({ timeout: 2000 })) {
          const text = await element.textContent();
          return { success: true, message: text || 'Application submitted successfully' };
        }
      } catch (e) {
        continue;
      }
    }
  } catch (e) {}

  // Check for error indicators in DOM
  try {
    const errorSelectors = [
      '.alert-danger',
      '.alert-error',
      '[class*="error" i]',
      '[role="alert"]',
    ];

    for (const selector of errorSelectors) {
      try {
        const element = page.locator(selector).first();
        if (await element.isVisible({ timeout: 2000 })) {
          const text = await element.textContent();
          return { success: false, message: text || 'Application failed' };
        }
      } catch (e) {
        continue;
      }
    }
  } catch (e) {}

  return {
    success: false,
    message: 'Could not determine application status - please verify manually',
  };
}

module.exports = {
  checkForRightShareApplyButton,
  clickRightShareApplyButton,
  clickRightShareRow,
  checkRightShareApplicationStatus,
};
