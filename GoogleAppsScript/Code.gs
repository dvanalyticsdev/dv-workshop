function doPost(e) {
  try {
    var payload = parsePayload_(e);
    var fullName = (payload.fullName || '').toString().trim();
    var email = (payload.email || '').toString().trim();
    var phone = (payload.phone || '').toString().trim();
    var workshopName = (payload.workshopName || '').toString().trim();
    var dateValue = payload.date || new Date().toISOString();

    if (!fullName || !email || !phone) {
      return jsonResponse_({
        ok: false,
        error: 'fullName, email, and phone are required.'
      }, 400);
    }

    var sheet = getOrCreateSheet_('Registrations');
    ensureHeaders_(sheet);

    // Format date as DD-MM-YYYY (date only, without time)
    var dateObj = new Date(dateValue);
    var formattedDate = formatDateDDMMYYYY_(dateObj);

    sheet.appendRow([
      formattedDate,
      fullName,
      email,
      phone,
      workshopName
    ]);

    return jsonResponse_({
      ok: true
    }, 200);
  } catch (error) {
    return jsonResponse_({
      ok: false,
      error: error.message || String(error)
    }, 500);
  }
}

function doGet() {
  return jsonResponse_({
    ok: true,
    message: 'Google Apps Script webhook is running.'
  }, 200);
}

function parsePayload_(e) {
  if (e && e.postData && e.postData.contents) {
    try {
      return JSON.parse(e.postData.contents);
    } catch (error) {
      throw new Error('Invalid JSON payload.');
    }
  }

  return (e && e.parameter) ? e.parameter : {};
}

function getOrCreateSheet_(sheetName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }

  return sheet;
}

function ensureHeaders_(sheet) {
  var headers = ['Date', 'Full Name', 'Email', 'Phone', 'Workshop Name'];
  var firstRow = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  var isEmpty = firstRow.every(function(cell) {
    return String(cell || '').trim() === '';
  });

  if (isEmpty) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
}

function jsonResponse_(obj, statusCode) {
  var output = ContentService.createTextOutput(JSON.stringify(obj));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

function formatDateDDMMYYYY_(dateObj) {
  var day = String(dateObj.getDate()).padStart(2, '0');
  var month = String(dateObj.getMonth() + 1).padStart(2, '0');
  var year = dateObj.getFullYear();
  return day + '-' + month + '-' + year;
}
