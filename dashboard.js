document.addEventListener('DOMContentLoaded', () => {
  let attendees = [];
  let filteredAttendees = [];

  const tableBody = document.getElementById('tableBody');
  const searchInput = document.getElementById('searchInput');
  const workshopFilter = document.getElementById('workshopFilter');
  const counselorFilter = document.getElementById('counselorFilter');
  const dateFilter = document.getElementById('dateFilter');
  const timeFilter = document.getElementById('timeFilter');
  const timeFilterCondition = document.getElementById('timeFilterCondition');
  const durationFilter = document.getElementById('durationFilter');
  const filterStatus = document.getElementById('filterStatus');

  const statTotal = document.getElementById('statTotal');
  const statAttended = document.getElementById('statAttended');
  const statAvgDuration = document.getElementById('statAvgDuration');
  const statCertified = document.getElementById('statCertified');
  const counselorBreakdownList = document.getElementById('counselorBreakdownList');

  const exportCsvBtn = document.getElementById('exportCsv');
  const exportExcelBtn = document.getElementById('exportExcel');

  // Fetch Attendance Data
  async function fetchAttendance() {
    try {
      const response = await fetch('/api/attendance');
      if (!response.ok) throw new Error('Failed to fetch attendance data');
      const data = await response.json();
      attendees = data.registrations || [];
      
      // Dynamically populate dropdown options
      populateWorkshops();
      populateCounselors();

      filteredAttendees = [...attendees];
      calculateMetrics();
      renderTable();
      renderCounselorBreakdown();
    } catch (error) {
      console.error(error);
      tableBody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; color: var(--accent); padding: 40px; font-weight: 700;">
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

  // Populate dynamic Counselor filter list
  function populateCounselors() {
    const counselors = new Set();
    attendees.forEach(a => {
      counselors.add(a.counselor || 'Unassigned');
    });

    counselorFilter.innerHTML = '<option value="all">All Counselors</option>';
    // Sort counselors (Unassigned last or alphabetical)
    const sortedCounselors = Array.from(counselors).sort((a, b) => {
      if (a === 'Unassigned') return 1;
      if (b === 'Unassigned') return -1;
      return a.localeCompare(b);
    });
    sortedCounselors.forEach(c => {
      const option = document.createElement('option');
      option.value = c;
      option.textContent = c;
      counselorFilter.appendChild(option);
    });
  }

  // Render Counselor Breakdown dynamic cards
  function renderCounselorBreakdown() {
    const stats = {};
    filteredAttendees.forEach(a => {
      const c = a.counselor || 'Unassigned';
      if (!stats[c]) {
        stats[c] = { total: 0, attended: 0 };
      }
      stats[c].total++;
      if ((a.joinedDuration || 0) > 0) {
        stats[c].attended++;
      }
    });

    if (filteredAttendees.length === 0) {
      counselorBreakdownList.innerHTML = '<div style="color: var(--muted); padding: 10px; font-size: 0.9rem;">No data for current filters</div>';
      return;
    }

    const sortedCounselors = Object.keys(stats).sort((a, b) => {
      if (a === 'Unassigned') return 1;
      if (b === 'Unassigned') return -1;
      return a.localeCompare(b);
    });

    counselorBreakdownList.innerHTML = sortedCounselors.map(c => {
      const s = stats[c];
      return `
        <div class="counselor-stat-pill">
          <span class="counselor-stat-name">${escapeHtml(c)}</span>
          <span class="counselor-stat-count">${s.total} <span style="font-size: 0.8rem; font-weight: 500; color: var(--muted);">joined</span></span>
          <span class="counselor-stat-attended">${s.attended} attended</span>
        </div>
      `;
    }).join('');
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
          <td colspan="8" class="empty-state">
            <h3>No participants found</h3>
            <p>Try resetting the filters or adjusting your search query.</p>
          </td>
        </tr>
      `;
      filterStatus.textContent = "Showing 0 records";
      return;
    }

    // Sort by Counselor, then by name
    const sorted = [...filteredAttendees].sort((a, b) => {
      const cA = a.counselor || 'Unassigned';
      const cB = b.counselor || 'Unassigned';
      if (cA === cB) {
        return a.fullName.localeCompare(b.fullName);
      }
      if (cA === 'Unassigned') return 1;
      if (cB === 'Unassigned') return -1;
      return cA.localeCompare(cB);
    });

    let html = [];
    let currentCounselor = null;

    // Calculate count per counselor in the filtered view for headers
    const counselorCounts = {};
    sorted.forEach(a => {
      const c = a.counselor || 'Unassigned';
      counselorCounts[c] = (counselorCounts[c] || 0) + 1;
    });

    sorted.forEach(a => {
      const c = a.counselor || 'Unassigned';
      if (c !== currentCounselor) {
        currentCounselor = c;
        const count = counselorCounts[c];
        html.push(`
          <tr class="counselor-group-row">
            <td colspan="8" class="counselor-group-cell">
              Counselor: ${escapeHtml(currentCounselor)} (${count} matched)
            </td>
          </tr>
        `);
      }

      html.push(`
        <tr>
          <td style="font-weight: 600;">${escapeHtml(a.fullName)}</td>
          <td>${escapeHtml(a.email)}</td>
          <td>${escapeHtml(a.phone)}</td>
          <td>${escapeHtml(a.workshopName || 'N/A')}</td>
          <td><span style="font-weight: 600; color: var(--accent-2);">${escapeHtml(a.counselor || 'Unassigned')}</span></td>
          <td>${formatDateTime(a.createdAt)}</td>
          <td>${formatDuration(a.joinedDuration)}</td>
          <td>${getStatusBadge(a.joinedDuration)}</td>
        </tr>
      `);
    });

    tableBody.innerHTML = html.join('');
    filterStatus.textContent = `Showing ${filteredAttendees.length} of ${attendees.length} records`;
  }

  // Apply Filter & Search
  function applyFilters() {
    const query = searchInput.value.toLowerCase().trim();
    const workshopVal = workshopFilter.value;
    const counselorVal = counselorFilter.value;
    const dateVal = dateFilter.value; // YYYY-MM-DD
    const timeVal = timeFilter.value; // HH:MM
    const timeCond = timeFilterCondition.value;
    const durationOption = durationFilter.value;

    filteredAttendees = attendees.filter(a => {
      // 1. Search Query
      const matchQuery = 
        a.fullName.toLowerCase().includes(query) ||
        a.email.toLowerCase().includes(query) ||
        a.phone.includes(query) ||
        (a.counselor && a.counselor.toLowerCase().includes(query));

      // 2. Workshop Filter
      const matchWorkshop = (workshopVal === 'all' || a.workshopName === workshopVal);

      // 3. Counselor Filter
      const matchCounselor = (counselorVal === 'all' || (a.counselor || 'Unassigned') === counselorVal);

      // 4. Date Filter
      let matchDate = true;
      if (dateVal) {
        const itemDate = new Date(a.createdAt).toLocaleDateString('en-CA'); // YYYY-MM-DD
        matchDate = (itemDate === dateVal);
      }

      // 5. Time Filter
      let matchTime = true;
      if (timeVal && timeCond !== 'none') {
        const itemTime = new Date(a.createdAt).toTimeString().slice(0, 5); // "HH:MM"
        if (timeCond === 'after') {
          matchTime = (itemTime >= timeVal);
        } else if (timeCond === 'before') {
          matchTime = (itemTime <= timeVal);
        }
      }

      // 6. Duration Filter
      const duration = a.joinedDuration || 0;
      let matchDuration = true;
      if (durationOption === 'certified') {
        matchDuration = duration >= 60;
      } else if (durationOption === 'attended') {
        matchDuration = duration >= 15 && duration < 60;
      } else if (durationOption === 'short') {
        matchDuration = duration < 15;
      }

      return matchQuery && matchWorkshop && matchCounselor && matchDate && matchTime && matchDuration;
    });

    renderTable();
    renderCounselorBreakdown();
  }

  // Dynamic Export function (CSV / Excel format)
  function exportData(type) {
    const dataList = filteredAttendees.length > 0 ? filteredAttendees : attendees;
    
    // Header columns matching table header
    const headers = ['Name', 'Email Address', 'Phone Number', 'Workshop Name', 'Counselor', 'Joined Date & Time', 'Total Joined Duration (Minutes)'];
    
    // Transform rows
    const rows = dataList.map(a => [
      `"${a.fullName.replace(/"/g, '""')}"`,
      `"${a.email.replace(/"/g, '""')}"`,
      `"${a.phone}"`,
      `"${(a.workshopName || 'N/A').replace(/"/g, '""')}"`,
      `"${(a.counselor || 'Unassigned').replace(/"/g, '""')}"`,
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
          <Cell><Data ss:Type="String">${escapeXml(r[5].replace(/"/g, ''))}</Data></Cell>
          <Cell><Data ss:Type="Number">${r[6]}</Data></Cell>
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
    <Cell><Data ss:Type="String">Counselor</Data></Cell>
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
  counselorFilter.addEventListener('change', applyFilters);
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

  // --- Password Protection Logic ---
  const passwordScreen = document.getElementById('passwordScreen');
  const passwordForm = document.getElementById('passwordForm');
  const passwordInput = document.getElementById('passwordInput');
  const passwordError = document.getElementById('passwordError');
  const togglePasswordBtn = document.getElementById('togglePasswordBtn');

  function setupAuth() {
    // Password visibility toggle
    if (togglePasswordBtn && passwordInput) {
      togglePasswordBtn.addEventListener('click', () => {
        const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
        passwordInput.setAttribute('type', type);
        
        // Toggle eye icon paths
        const eyeOpenSvg = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
        const eyeClosedSvg = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;
        
        togglePasswordBtn.innerHTML = type === 'password' ? eyeOpenSvg : eyeClosedSvg;
      });
    }

    if (passwordForm) {
      passwordForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const pwd = passwordInput.value;
        const correctPassword = 'dv@dev@2010@analytics';

        if (pwd === correctPassword) {
          // Success!
          passwordError.classList.add('hidden');
          sessionStorage.setItem('attendance_auth', correctPassword);
          
          // Animate transition
          if (passwordScreen) {
            passwordScreen.classList.add('fade-out');
            setTimeout(() => {
              document.documentElement.classList.remove('needs-auth');
              document.documentElement.classList.add('is-authenticated');
              passwordScreen.style.display = 'none';
            }, 400); // matches fade-out duration
          } else {
            document.documentElement.classList.remove('needs-auth');
            document.documentElement.classList.add('is-authenticated');
          }
          
          // Load data
          fetchAttendance();
          fetchSchedule();
        } else {
          // Failure
          passwordError.classList.remove('hidden');
          passwordError.classList.remove('shake');
          void passwordError.offsetWidth; // trigger reflow to restart animation
          passwordError.classList.add('shake');
          passwordInput.value = '';
          passwordInput.focus();
        }
      });
    }
  }

  // --- Schedule Gate Settings Logic ---
  const scheduleForm = document.getElementById('scheduleForm');
  const scheduleStartDate = document.getElementById('scheduleStartDate');
  const scheduleStartTime = document.getElementById('scheduleStartTime');
  const scheduleEndDate = document.getElementById('scheduleEndDate');
  const scheduleEndTime = document.getElementById('scheduleEndTime');
  const registrationStatusPill = document.getElementById('registrationStatusPill');
  const saveScheduleBtn = document.getElementById('saveScheduleBtn');

  function splitIsoToLocalDateAndTime(isoString) {
    if (!isoString) return { date: '', time: '' };
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return { date: '', time: '' };
    
    const pad = num => String(num).padStart(2, '0');
    return {
      date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
      time: `${pad(d.getHours())}:${pad(d.getMinutes())}`
    };
  }

  async function fetchSchedule() {
    try {
      const response = await fetch('/api/status');
      if (!response.ok) throw new Error('Failed to fetch schedule');
      const data = await response.json();

      if (data.startTime) {
        const startParts = splitIsoToLocalDateAndTime(data.startTime);
        scheduleStartDate.value = startParts.date;
        scheduleStartTime.value = startParts.time;
      }
      if (data.endTime) {
        const endParts = splitIsoToLocalDateAndTime(data.endTime);
        scheduleEndDate.value = endParts.date;
        scheduleEndTime.value = endParts.time;
      }

      updateStatusPill(data.isLive);
    } catch (err) {
      console.error('Error fetching schedule:', err);
    }
  }

  function updateStatusPill(isLive) {
    if (isLive) {
      registrationStatusPill.textContent = 'Active (ON)';
      registrationStatusPill.className = 'status-badge badge-on';
    } else {
      registrationStatusPill.textContent = 'Inactive (OFF)';
      registrationStatusPill.className = 'status-badge badge-off';
    }
  }

  if (scheduleForm) {
    scheduleForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const startDateVal = scheduleStartDate.value;
      const startTimeVal = scheduleStartTime.value;
      const endDateVal = scheduleEndDate.value;
      const endTimeVal = scheduleEndTime.value;
      
      if (!startDateVal || !startTimeVal || !endDateVal || !endTimeVal) {
        alert('Please select all date and time fields.');
        return;
      }

      const startTime = new Date(`${startDateVal}T${startTimeVal}`).toISOString();
      const endTime = new Date(`${endDateVal}T${endTimeVal}`).toISOString();

      if (new Date(startTime) >= new Date(endTime)) {
        alert('Start time must be before end time.');
        return;
      }

      try {
        saveScheduleBtn.disabled = true;
        saveScheduleBtn.textContent = 'Saving...';

        const response = await fetch('/api/schedule', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ startTime, endTime })
        });

        if (!response.ok) {
          const errData = await response.json();
          throw new Error(errData.error || 'Failed to save schedule');
        }

        const data = await response.json();
        alert('Schedule saved successfully.');
        
        if (data.schedule.startTime) {
          const startParts = splitIsoToLocalDateAndTime(data.schedule.startTime);
          scheduleStartDate.value = startParts.date;
          scheduleStartTime.value = startParts.time;
        }
        if (data.schedule.endTime) {
          const endParts = splitIsoToLocalDateAndTime(data.schedule.endTime);
          scheduleEndDate.value = endParts.date;
          scheduleEndTime.value = endParts.time;
        }
        updateStatusPill(data.status.isLive);
      } catch (err) {
        console.error('Error saving schedule:', err);
        alert(err.message);
      } finally {
        saveScheduleBtn.disabled = false;
        saveScheduleBtn.textContent = 'Save Schedule';
      }
    });
  }

  // Initialize
  const authVal = sessionStorage.getItem('attendance_auth');
  if (authVal === 'dv@dev@2010@analytics') {
    fetchAttendance();
    fetchSchedule();
  } else {
    setupAuth();
  }
});
