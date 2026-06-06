document.addEventListener('DOMContentLoaded', () => {
  let attendees = [];
  let filteredAttendees = [];

  const tableBody = document.getElementById('tableBody');
  const searchInput = document.getElementById('searchInput');
  const workshopFilter = document.getElementById('workshopFilter');
  const dateFilter = document.getElementById('dateFilter');
  const timeFilter = document.getElementById('timeFilter');
  const timeFilterCondition = document.getElementById('timeFilterCondition');
  const durationFilter = document.getElementById('durationFilter');
  const filterStatus = document.getElementById('filterStatus');

  const statTotal = document.getElementById('statTotal');
  const statAttended = document.getElementById('statAttended');
  const statAvgDuration = document.getElementById('statAvgDuration');
  const statCertified = document.getElementById('statCertified');

  const exportCsvBtn = document.getElementById('exportCsv');
  const exportExcelBtn = document.getElementById('exportExcel');

  // Fetch Attendance Data
  async function fetchAttendance() {
    try {
      const response = await fetch('/api/attendance');
      if (!response.ok) throw new Error('Failed to fetch attendance data');
      const data = await response.json();
      attendees = data.registrations || [];
      
      // Dynamically populate Workshop dropdown options
      populateWorkshops();

      filteredAttendees = [...attendees];
      calculateMetrics();
      renderTable();
    } catch (error) {
      console.error(error);
      tableBody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; color: var(--accent); padding: 40px; font-weight: 700;">
            Failed to load attendance list. Please verify the backend server is running.
          </td>
        </tr>
      `;
    }
  }

  // Populate dynamic Workshop filter list
  function populateWorkshops() {
    const workshops = new Set();
    attendees.forEach(a => {
      if (a.workshopName) workshops.add(a.workshopName);
    });

    // Reset list
    workshopFilter.innerHTML = '<option value="all">All Workshops</option>';
    workshops.forEach(w => {
      const option = document.createElement('option');
      option.value = w;
      option.textContent = w;
      workshopFilter.appendChild(option);
    });
  }

  // Calculate Metrics
  function calculateMetrics() {
    const total = attendees.length;
    const attended = attendees.filter(a => (a.joinedDuration || 0) > 0).length;
    const certified = attendees.filter(a => (a.joinedDuration || 0) >= 60).length;
    
    const totalDuration = attendees.reduce((acc, a) => acc + (a.joinedDuration || 0), 0);
    const avgDuration = attended > 0 ? Math.round(totalDuration / attended) : 0;

    statTotal.textContent = total;
    statAttended.textContent = attended;
    statAvgDuration.textContent = formatDuration(avgDuration);
    statCertified.textContent = certified;
  }

  // Format Duration into readables
  function formatDuration(minutes) {
    if (!minutes) return '0m';
    if (minutes < 60) return `${minutes}m`;
    const hrs = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
  }

  // Format full Date and Time
  function formatDateTime(isoString) {
    if (!isoString) return '-';
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return '-';
    
    const datePart = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    const timePart = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: true });
    return `${datePart} at ${timePart}`;
  }

  // Get status badge based on duration
  function getStatusBadge(minutes) {
    const minVal = minutes || 0;
    if (minVal >= 60) {
      return `<span class="status-badge badge-certified">Certified (&gt; 1 hr)</span>`;
    } else if (minVal >= 15) {
      return `<span class="status-badge badge-attended">Attended</span>`;
    } else {
      return `<span class="status-badge badge-short">Short Stay</span>`;
    }
  }

  // Render Table Rows
  function renderTable() {
    if (filteredAttendees.length === 0) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="7" class="empty-state">
            <h3>No participants found</h3>
            <p>Try resetting the filters or adjusting your search query.</p>
          </td>
        </tr>
      `;
      filterStatus.textContent = "Showing 0 records";
      return;
    }

    tableBody.innerHTML = filteredAttendees.map(a => `
      <tr>
        <td style="font-weight: 600;">${escapeHtml(a.fullName)}</td>
        <td>${escapeHtml(a.email)}</td>
        <td>${escapeHtml(a.phone)}</td>
        <td>${escapeHtml(a.workshopName || 'N/A')}</td>
        <td>${formatDateTime(a.createdAt)}</td>
        <td>${formatDuration(a.joinedDuration)}</td>
        <td>${getStatusBadge(a.joinedDuration)}</td>
      </tr>
    `).join('');

    filterStatus.textContent = `Showing ${filteredAttendees.length} of ${attendees.length} records`;
  }

  // Apply Filter & Search
  function applyFilters() {
    const query = searchInput.value.toLowerCase().trim();
    const workshopVal = workshopFilter.value;
    const dateVal = dateFilter.value; // YYYY-MM-DD
    const timeVal = timeFilter.value; // HH:MM
    const timeCond = timeFilterCondition.value;
    const durationOption = durationFilter.value;

    filteredAttendees = attendees.filter(a => {
      // 1. Search Query
      const matchQuery = 
        a.fullName.toLowerCase().includes(query) ||
        a.email.toLowerCase().includes(query) ||
        a.phone.includes(query);

      // 2. Workshop Filter
      const matchWorkshop = (workshopVal === 'all' || a.workshopName === workshopVal);

      // 3. Date Filter
      let matchDate = true;
      if (dateVal) {
        const itemDate = new Date(a.createdAt).toLocaleDateString('en-CA'); // YYYY-MM-DD
        matchDate = (itemDate === dateVal);
      }

      // 4. Time Filter
      let matchTime = true;
      if (timeVal && timeCond !== 'none') {
        const itemTime = new Date(a.createdAt).toTimeString().slice(0, 5); // "HH:MM"
        if (timeCond === 'after') {
          matchTime = (itemTime >= timeVal);
        } else if (timeCond === 'before') {
          matchTime = (itemTime <= timeVal);
        }
      }

      // 5. Duration Filter
      const duration = a.joinedDuration || 0;
      let matchDuration = true;
      if (durationOption === 'certified') {
        matchDuration = duration >= 60;
      } else if (durationOption === 'attended') {
        matchDuration = duration >= 15 && duration < 60;
      } else if (durationOption === 'short') {
        matchDuration = duration < 15;
      }

      return matchQuery && matchWorkshop && matchDate && matchTime && matchDuration;
    });

    renderTable();
  }

  // Dynamic Export function (CSV / Excel format)
  function exportData(type) {
    const dataList = filteredAttendees.length > 0 ? filteredAttendees : attendees;
    
    // Header columns matching table header
    const headers = ['Name', 'Email Address', 'Phone Number', 'Workshop Name', 'Joined Date & Time', 'Total Joined Duration (Minutes)'];
    
    // Transform rows
    const rows = dataList.map(a => [
      `"${a.fullName.replace(/"/g, '""')}"`,
      `"${a.email.replace(/"/g, '""')}"`,
      `"${a.phone}"`,
      `"${(a.workshopName || 'N/A').replace(/"/g, '""')}"`,
      `"${formatDateTime(a.createdAt)}"`,
      a.joinedDuration || 0
    ]);

    let content = '';
    let mimeType = '';
    let fileExtension = '';

    if (type === 'csv') {
      content = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      mimeType = 'text/csv;charset=utf-8;';
      fileExtension = '.csv';
    } else {
      // Create XML spreadsheet schema for Excel compatibility
      const xmlRows = rows.map(r => `
        <Row>
          <Cell><Data ss:Type="String">${escapeXml(r[0].replace(/"/g, ''))}</Data></Cell>
          <Cell><Data ss:Type="String">${escapeXml(r[1].replace(/"/g, ''))}</Data></Cell>
          <Cell><Data ss:Type="String">${escapeXml(r[2].replace(/"/g, ''))}</Data></Cell>
          <Cell><Data ss:Type="String">${escapeXml(r[3].replace(/"/g, ''))}</Data></Cell>
          <Cell><Data ss:Type="String">${escapeXml(r[4].replace(/"/g, ''))}</Data></Cell>
          <Cell><Data ss:Type="Number">${r[5]}</Data></Cell>
        </Row>
      `).join('');

      content = `<?xml version="1.0"?>
<?mso-application myprogid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <Worksheet ss:Name="Attendance">
  <Table>
   <Row>
    <Cell><Data ss:Type="String">Name</Data></Cell>
    <Cell><Data ss:Type="String">Email Address</Data></Cell>
    <Cell><Data ss:Type="String">Phone Number</Data></Cell>
    <Cell><Data ss:Type="String">Workshop Name</Data></Cell>
    <Cell><Data ss:Type="String">Joined Date & Time</Data></Cell>
    <Cell><Data ss:Type="String">Joined Duration (Minutes)</Data></Cell>
   </Row>
   ${xmlRows}
  </Table>
 </Worksheet>
</Workbook>`;
      mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=utf-8;';
      fileExtension = '.xls';
    }

    const blob = new Blob([content], { type: mimeType });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `Workshop_Attendance_Export_${new Date().toISOString().slice(0,10)}${fileExtension}`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  // Safe HTML Escaping
  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#039;');
  }

  // Safe XML Escaping
  function escapeXml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&apos;');
  }

  // Event Listeners
  searchInput.addEventListener('input', applyFilters);
  workshopFilter.addEventListener('change', applyFilters);
  dateFilter.addEventListener('input', applyFilters);
  timeFilter.addEventListener('input', applyFilters);
  timeFilterCondition.addEventListener('change', applyFilters);
  durationFilter.addEventListener('change', applyFilters);

  exportCsvBtn.addEventListener('click', () => exportData('csv'));
  exportExcelBtn.addEventListener('click', () => exportData('excel'));

  const clearListBtn = document.getElementById('clearListBtn');
  clearListBtn.addEventListener('click', async () => {
    if (confirm('Are you sure you want to clear the entire attendance list? This action cannot be undone.')) {
      try {
        clearListBtn.disabled = true;
        clearListBtn.textContent = 'Clearing...';
        const response = await fetch('/api/attendance/clear', { method: 'POST' });
        if (!response.ok) throw new Error('Failed to clear list');
        alert('Attendance list cleared successfully.');
        await fetchAttendance();
      } catch (error) {
        console.error(error);
        alert('Error: ' + error.message);
      } finally {
        clearListBtn.disabled = false;
        clearListBtn.innerHTML = `
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
          Clear List
        `;
      }
    }
  });

  // Initialize
  fetchAttendance();
});
