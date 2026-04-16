const { ImapService } = require('./services/imap.service');

async function getEmails() {
  if (ImapService.isFetchInProgress()) {
    console.log('Skipping email fetch because a previous run is still in progress');
    return;
  }

  try {
    await ImapService.fetchEmails();
    console.log('Email fetch completed');
  } catch (error) {
    console.error('An error occurred while fetching emails:', error);
  }
}

module.exports = { getEmails };
