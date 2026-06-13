document.addEventListener('DOMContentLoaded', () => {
  const PAGE_SIZE = 50;
  const WORKSHOP_TIMEZONE = 'Asia/Kolkata';
  const WORKSHOP_OFFSET_MINUTES = 330;

  let attendees = [];
  let filteredAttendees = [];
  let schedulesCache = [];
  let currentPage = 1;
  let isAttendanceLoading = true;
  let activeAttendanceDate = '';
  let activeAttendanceScope = 'today';

  // ── Toast Notification System ──────────────────────────────────────────────
  (function setupToastSystem() {
    if (document.getElementById('dv-toast-container')) return;
    const style = document.createElement('style');
    style.textContent = `
      #dv-toast-container {
        position: fixed;
        top: 20px;
        right: 20px;
        z-index: 99999;
        display: flex;
        flex-direction: column;
        gap: 10px;
        pointer-events: none;
      }
      .dv-toast {
        display: flex;
        align-items: flex-start;
        gap: 12px;
        padding: 14px 18px;
        border-radius: 12px;
        min-width: 280px;
        max-width: 380px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.18), 0 2px 8px rgba(0,0,0,0.10);
        font-family: 'Outfit', 'Inter', sans-serif;
        font-size: 0.9rem;
        font-weight: 500;
        line-height: 1.4;
        pointer-events: all;
        cursor: pointer;
        animation: dv-toast-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        backdrop-filter: blur(12px);
        border: 1px solid rgba(255,255,255,0.18);
      }
      .dv-toast.success {
        background: linear-gradient(135deg, rgba(16, 185, 129, 0.95), rgba(5, 150, 105, 0.95));
        color: #fff;
      }
      .dv-toast.error {
        background: linear-gradient(135deg, rgba(239, 68, 68, 0.95), rgba(220, 38, 38, 0.95));
        color: #fff;
      }
      .dv-toast.info {
        background: linear-gradient(135deg, rgba(59, 130, 246, 0.95), rgba(37, 99, 235, 0.95));
        color: #fff;
      }
      .dv-toast-icon { font-size: 1.3rem; flex-shrink: 0; line-height: 1; margin-top: 1px; }
      .dv-toast-body { flex: 1; }
      .dv-toast-title { font-weight: 700; font-size: 0.95rem; }
      .dv-toast-msg { font-weight: 400; font-size: 0.85rem; opacity: 0.92; margin-top: 2px; }
      .dv-toast-dismiss {
        flex-shrink: 0;
        background: none;
        border: none;
        color: rgba(255,255,255,0.7);
        cursor: pointer;
        font-size: 1.1rem;
        line-height: 1;
        padding: 0;
        margin-top: 1px;
        transition: color 0.15s;
      }
      .dv-toast-dismiss:hover { color: #fff; }
      @keyframes dv-toast-in {
        from { opacity: 0; transform: translateX(60px) scale(0.92); }
        to   { opacity: 1; transform: translateX(0) scale(1); }
      }
      @keyframes dv-toast-out {
        from { opacity: 1; transform: translateX(0) scale(1); max-height: 100px; margin-bottom: 0; }
        to   { opacity: 0; transform: translateX(60px) scale(0.92); max-height: 0; margin-bottom: -10px; }
      }
      .dv-toast.hiding { animation: dv-toast-out 0.3s ease forwards; }
    `;
    document.head.appendChild(style);
    const container = document.createElement('div');
    container.id = 'dv-toast-container';
    document.body.appendChild(container);
  })();

  function showToast(type, title, message, duration = 4000) {
    const container = document.getElementById('dv-toast-container');
    if (!container) return;
    const icons = { success: '✅', error: '❌', info: 'ℹ️' };
    const toast = document.createElement('div');
    toast.className = `dv-toast ${type}`;
    toast.innerHTML = `
      <span class="dv-toast-icon">${icons[type] || '🔔'}</span>
      <div class="dv-toast-body">
        <div class="dv-toast-title">${title}</div>
        ${message ? `<div class="dv-toast-msg">${message}</div>` : ''}
      </div>
      <button class="dv-toast-dismiss" aria-label="Dismiss">&times;</button>
    `;
    function dismiss() {
      toast.classList.add('hiding');
      setTimeout(() => toast.remove(), 320);
    }
    toast.querySelector('.dv-toast-dismiss').addEventListener('click', dismiss);
    toast.addEventListener('click', dismiss);
    container.appendChild(toast);
    if (duration > 0) setTimeout(dismiss, duration);
    return toast;
  }

  const tableBody = document.getElementById('tableBody');
  const searchInput = document.getElementById('searchInput');
  const workshopFilter = document.getElementById('workshopFilter');
  const counselorFilter = document.getElementById('counselorFilter');
  const recordScopeFilter = document.getElementById('recordScopeFilter');
  const dateFilter = document.getElementById('dateFilter');
  const todayShortcutBtn = document.getElementById('todayShortcutBtn');
  const timeFilter = document.getElementById('timeFilter');
  const timeFilterCondition = document.getElementById('timeFilterCondition');
  const durationFilter = document.getElementById('durationFilter');
  const durationSort = document.getElementById('durationSort');
  const filterStatus = document.getElementById('filterStatus');
  const paginationSummary = document.getElementById('paginationSummary');
  const pageIndicator = document.getElementById('pageIndicator');
  const prevPageBtn = document.getElementById('prevPageBtn');
  const nextPageBtn = document.getElementById('nextPageBtn');

  const statTotal = document.getElementById('statTotal');
  const statAttended = document.getElementById('statAttended');
  const statAvgDuration = document.getElementById('statAvgDuration');
  const statCertified = document.getElementById('statCertified');
  const counselorBreakdownList = document.getElementById('counselorBreakdownList');

  const exportCsvBtn = document.getElementById('exportCsv');
  const exportExcelBtn = document.getElementById('exportExcel');

  function getCurrentWorkshopDate() {
    return getDateKeyInTimezone(new Date());
  }

  function getSelectedAttendanceScope() {
    return recordScopeFilter?.value || 'today';
  }

  function ensureActiveAttendanceDate(scope = getSelectedAttendanceScope()) {
    if (scope === 'today') {
      dateFilter.value = getCurrentWorkshopDate();
    } else if (!dateFilter.value) {
      dateFilter.value = getCurrentWorkshopDate();
    }
    activeAttendanceDate = dateFilter.value;
    return activeAttendanceDate;
  }

  function syncDateFilterState() {
    const scope = getSelectedAttendanceScope();
    const useDateInput = scope !== 'all';
    dateFilter.disabled = !useDateInput;

    if (todayShortcutBtn) {
      todayShortcutBtn.disabled = scope === 'today';
    }

    if (scope === 'today') {
      dateFilter.value = getCurrentWorkshopDate();
    } else if (!dateFilter.value) {
      dateFilter.value = getCurrentWorkshopDate();
    }
  }

  function renderAttendanceLoadingState() {
    tableBody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; padding: 40px; color: var(--muted);">Loading attendance data...</td>
      </tr>
    `;
    filterStatus.textContent = 'Loading records...';
    paginationSummary.textContent = 'Loading records...';
    pageIndicator.textContent = 'Page 1 of 1';
    prevPageBtn.disabled = true;
    nextPageBtn.disabled = true;
  }

  // Fetch Attendance Data
  async function fetchAttendance(options = {}) {
    const requestedScope = options.scope || getSelectedAttendanceScope();
    const targetDate = options.date || ensureActiveAttendanceDate(requestedScope);
    isAttendanceLoading = true;
    renderAttendanceLoadingState();
    activeAttendanceDate = targetDate;
    activeAttendanceScope = requestedScope;

    try {
      const params = new URLSearchParams();
      if (requestedScope === 'all') {
        params.set('scope', 'all');
      } else {
        params.set('date', targetDate);
      }

      const response = await fetch(`/api/attendance?${params.toString()}`);
      if (!response.ok) throw new Error('Failed to fetch attendance data');
      const data = await response.json();
      attendees = normalizeAttendanceRecords(data.registrations || []);
      
      // Dynamically populate dropdown options
      populateWorkshops();
      populateCounselors();

      filteredAttendees = [...attendees];
      isAttendanceLoading = false;
      applyFilters();
    } catch (error) {
      isAttendanceLoading = false;
      console.error(error);
      tableBody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; color: var(--accent); padding: 40px; font-weight: 700;">
            Failed to load attendance list. Please verify the backend server is running.
          </td>
        </tr>
      `;
      filterStatus.textContent = 'Unable to load records';
      paginationSummary.textContent = 'Unable to load records';
      pageIndicator.textContent = 'Page 1 of 1';
      prevPageBtn.disabled = true;
      nextPageBtn.disabled = true;
    }
  }

  function normalizeAttendanceRecords(records) {
    return records.map(record => {
      const effectiveJoinedDuration = getEffectiveJoinedDuration(record);
      return {
        ...record,
        effectiveJoinedDuration
      };
    });
  }

  function getEffectiveJoinedDuration(record) {
    const storedDuration = Math.max(0, Number(record.joinedDuration) || 0);
    const createdMs = new Date(record.createdAt).getTime();
    const lastSeenMs = record.lastSeenAt ? new Date(record.lastSeenAt).getTime() : createdMs;

    if (Number.isNaN(createdMs)) {
      return storedDuration;
    }

    const scheduleStartMs = getScheduleStartForRecord(record);
    if (!scheduleStartMs) {
      return storedDuration;
    }

    const effectiveStartMs = Math.max(createdMs, scheduleStartMs);
    const effectiveEndMs = Number.isNaN(lastSeenMs) ? createdMs : Math.max(lastSeenMs, createdMs);

    if (effectiveEndMs < effectiveStartMs) {
      return 0;
    }

    const windowMinutes = Math.floor((effectiveEndMs - effectiveStartMs) / 60000) + 1;
    return Math.min(storedDuration, Math.max(0, windowMinutes));
  }

  function getScheduleStartForRecord(record) {
    const recordMs = new Date(record.createdAt).getTime();
    const startCandidates = [];

    if (record.workshopStartsAt) {
      const workshopStartMs = new Date(record.workshopStartsAt).getTime();
      if (!Number.isNaN(workshopStartMs)) {
        startCandidates.push(workshopStartMs);
      }
    }

    const sameDaySchedule = schedulesCache.find(schedule => {
      const startMs = new Date(schedule.startTime).getTime();
      const endMs = new Date(schedule.endTime).getTime();
      if (Number.isNaN(startMs) || Number.isNaN(endMs) || Number.isNaN(recordMs)) {
        return false;
      }
      return isSameWorkshopDay(record.createdAt, schedule.startTime) || (recordMs >= startMs && recordMs <= endMs);
    });

    if (sameDaySchedule) {
      const scheduleStartMs = new Date(sameDaySchedule.startTime).getTime();
      if (!Number.isNaN(scheduleStartMs)) {
        startCandidates.push(scheduleStartMs);
      }
    }

    if (startCandidates.length === 0) {
      return null;
    }

    return Math.max(...startCandidates);
  }

  function isSameWorkshopDay(isoA, isoB) {
    return getDateKeyInTimezone(isoA) === getDateKeyInTimezone(isoB);
  }

  function getDateKeyInTimezone(dateLike) {
    const d = new Date(dateLike);
    if (Number.isNaN(d.getTime())) return '';
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: WORKSHOP_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(d);
    const mapped = {};
    parts.forEach(part => {
      if (part.type !== 'literal') {
        mapped[part.type] = part.value;
      }
    });
    return `${mapped.year}-${mapped.month}-${mapped.day}`;
  }

  function getTimePartsInTimezone(dateLike) {
    const d = new Date(dateLike);
    if (Number.isNaN(d.getTime())) {
      return { year: '', month: '', day: '', hour: '', minute: '' };
    }

    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: WORKSHOP_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).formatToParts(d);

    const mapped = {};
    parts.forEach(part => {
      if (part.type !== 'literal') {
        mapped[part.type] = part.value;
      }
    });

    return mapped;
  }

  function splitIsoToWorkshopDateAndTime(isoString) {
    const parts = getTimePartsInTimezone(isoString);
    if (!parts.year) return { date: '', time: '' };
    return {
      date: `${parts.year}-${parts.month}-${parts.day}`,
      time: `${parts.hour}:${parts.minute}`
    };
  }

  function workshopLocalToIso(dateString, timeString) {
    const [year, month, day] = dateString.split('-').map(Number);
    const [hour, minute] = timeString.split(':').map(Number);
    const utcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0) - (WORKSHOP_OFFSET_MINUTES * 60 * 1000);
    return new Date(utcMs).toISOString();
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
      if ((a.effectiveJoinedDuration || 0) > 0) {
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
    const dataset = filteredAttendees;
    const total = dataset.length;
    const attended = dataset.filter(a => (a.effectiveJoinedDuration || 0) > 0).length;
    const certified = dataset.filter(a => (a.effectiveJoinedDuration || 0) >= 60).length;
    
    const totalDuration = dataset.reduce((acc, a) => acc + (a.effectiveJoinedDuration || 0), 0);
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
    
    const datePart = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: WORKSHOP_TIMEZONE });
    const timePart = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: WORKSHOP_TIMEZONE });
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
    if (isAttendanceLoading) {
      renderAttendanceLoadingState();
      return;
    }

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
      paginationSummary.textContent = '';
      pageIndicator.textContent = '';
      prevPageBtn.hidden = true;
      nextPageBtn.hidden = true;
      return;
    }

    prevPageBtn.hidden = false;
    nextPageBtn.hidden = false;

    // Sort by Counselor, then by name, or by duration if selected
    const durationSortVal = durationSort ? durationSort.value : 'default';
    const sorted = [...filteredAttendees];
    if (durationSortVal === 'highToLow') {
      sorted.sort((a, b) => (b.effectiveJoinedDuration || 0) - (a.effectiveJoinedDuration || 0));
    } else if (durationSortVal === 'lowToHigh') {
      sorted.sort((a, b) => (a.effectiveJoinedDuration || 0) - (b.effectiveJoinedDuration || 0));
    } else {
      sorted.sort((a, b) => {
        const cA = a.counselor || 'Unassigned';
        const cB = b.counselor || 'Unassigned';
        if (cA === cB) {
          return a.fullName.localeCompare(b.fullName);
        }
        if (cA === 'Unassigned') return 1;
        if (cB === 'Unassigned') return -1;
        return cA.localeCompare(cB);
      });
    }

    const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
    if (currentPage > totalPages) {
      currentPage = totalPages;
    }

    const startIndex = (currentPage - 1) * PAGE_SIZE;
    const endIndex = Math.min(startIndex + PAGE_SIZE, sorted.length);
    const pageRows = sorted.slice(startIndex, endIndex);

    let html = [];
    let currentCounselor = null;

    // Calculate count per counselor in the filtered view for headers
    const counselorCounts = {};
    sorted.forEach(a => {
      const c = a.counselor || 'Unassigned';
      counselorCounts[c] = (counselorCounts[c] || 0) + 1;
    });

    pageRows.forEach(a => {
      const c = a.counselor || 'Unassigned';
      if (durationSortVal === 'default') {
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
      }

      html.push(`
        <tr>
          <td style="font-weight: 600;">${escapeHtml(a.fullName)}</td>
          <td>${escapeHtml(a.email)}</td>
          <td>${escapeHtml(a.phone)}</td>
          <td>${escapeHtml(a.workshopName || 'N/A')}</td>
          <td><span style="font-weight: 600; color: var(--accent-2);">${escapeHtml(a.counselor || 'Unassigned')}</span></td>
          <td>${formatDateTime(a.createdAt)}</td>
          <td>${formatDuration(a.effectiveJoinedDuration)}</td>
          <td>${getStatusBadge(a.effectiveJoinedDuration)}</td>
        </tr>
      `);
    });

    tableBody.innerHTML = html.join('');
    const scopeLabel = activeAttendanceScope === 'all'
      ? 'all dates'
      : `date ${activeAttendanceDate}`;
    filterStatus.textContent = `Showing ${filteredAttendees.length} of ${attendees.length} records for ${scopeLabel}`;
    paginationSummary.textContent = `Rows ${startIndex + 1}-${endIndex} of ${sorted.length}`;
    pageIndicator.textContent = `Page ${currentPage} of ${totalPages}`;
    prevPageBtn.disabled = currentPage === 1;
    nextPageBtn.disabled = currentPage === totalPages;
  }

  // Apply Filter & Search
  function applyFilters() {
    const query = searchInput.value.toLowerCase().trim();
    const workshopVal = workshopFilter.value;
    const counselorVal = counselorFilter.value;
    const dateVal = activeAttendanceScope === 'all' ? '' : ensureActiveAttendanceDate(activeAttendanceScope); // YYYY-MM-DD
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
        const itemDate = getDateKeyInTimezone(a.createdAt);
        matchDate = (itemDate === dateVal);
      }

      // 5. Time Filter
      let matchTime = true;
      if (timeVal && timeCond !== 'none') {
        const parts = getTimePartsInTimezone(a.createdAt);
        const itemTime = `${parts.hour || '00'}:${parts.minute || '00'}`;
        if (timeCond === 'after') {
          matchTime = (itemTime >= timeVal);
        } else if (timeCond === 'before') {
          matchTime = (itemTime <= timeVal);
        }
      }

      // 6. Duration Filter
      const duration = a.effectiveJoinedDuration || 0;
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

    currentPage = 1;
    calculateMetrics();
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
      a.effectiveJoinedDuration || 0
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

  // Debounce helper
  function debounce(fn, delay) {
    let timer = null;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  // Event Listeners
  searchInput.addEventListener('input', debounce(applyFilters, 200));
  workshopFilter.addEventListener('change', applyFilters);
  counselorFilter.addEventListener('change', applyFilters);
  if (recordScopeFilter) {
    recordScopeFilter.value = 'today';
    recordScopeFilter.addEventListener('change', () => {
      syncDateFilterState();
      fetchAttendance({
        scope: getSelectedAttendanceScope(),
        date: ensureActiveAttendanceDate(getSelectedAttendanceScope())
      });
    });
  }
  syncDateFilterState();
  dateFilter.addEventListener('change', () => {
    if (getSelectedAttendanceScope() === 'all') {
      return;
    }
    const selectedDate = dateFilter.value || getCurrentWorkshopDate();
    dateFilter.value = selectedDate;
    fetchAttendance({
      scope: getSelectedAttendanceScope(),
      date: selectedDate
    });
  });
  if (todayShortcutBtn) {
    todayShortcutBtn.addEventListener('click', () => {
      if (recordScopeFilter) {
        recordScopeFilter.value = 'today';
      }
      syncDateFilterState();
      fetchAttendance({
        scope: 'today',
        date: getCurrentWorkshopDate()
      });
    });
  }
  timeFilter.addEventListener('input', applyFilters);
  timeFilterCondition.addEventListener('change', applyFilters);
  durationFilter.addEventListener('change', applyFilters);
  if (durationSort) {
    durationSort.addEventListener('change', () => {
      currentPage = 1;
      renderTable();
    });
  }

  const scheduleListsContainer = document.getElementById('scheduleListsContainer');
  if (scheduleListsContainer) {
    scheduleListsContainer.addEventListener('click', async (e) => {
      const btn = e.target.closest('.delete-schedule-btn');
      if (!btn) return;

      const id = btn.getAttribute('data-id');
      if (!confirm('Are you sure you want to delete this schedule?')) return;

      // Disable this button immediately to prevent double-clicks
      btn.disabled = true;
      btn.style.opacity = '0.4';
      btn.style.cursor = 'not-allowed';

      try {
        const response = await fetch('/api/schedule/delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id })
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || `Server error ${response.status}`);
        }

        // Confirm the deletion actually worked on the server
        const result = await response.json();
        if (!result.ok) throw new Error(result.error || 'Deletion was not confirmed by server.');

        showToast('success', 'Schedule Deleted', 'The schedule has been removed successfully.');

        // Always re-fetch from server to ensure UI matches actual backend state
        await fetchSchedule();
      } catch (err) {
        console.error('Error deleting schedule:', err);
        showToast('error', 'Delete Failed', err.message);
        // Re-enable button so user can retry
        btn.disabled = false;
        btn.style.opacity = '';
        btn.style.cursor = '';
      }
    });
  }
  prevPageBtn.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      renderTable();
    }
  });
  nextPageBtn.addEventListener('click', () => {
    const totalPages = Math.max(1, Math.ceil(filteredAttendees.length / PAGE_SIZE));
    if (currentPage < totalPages) {
      currentPage++;
      renderTable();
    }
  });

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
        showToast('success', 'Attendance Cleared', 'The attendance list has been cleared successfully.');
        await fetchAttendance();
      } catch (error) {
        console.error(error);
        showToast('error', 'Clear Failed', error.message);
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
  const passwordSubmitBtn = document.getElementById('passwordSubmitBtn');

  function revealDashboard() {
    passwordError.classList.add('hidden');

    if (passwordScreen) {
      passwordScreen.classList.add('fade-out');
      setTimeout(() => {
        document.documentElement.classList.remove('needs-auth');
        document.documentElement.classList.add('is-authenticated');
        passwordScreen.style.display = 'none';
      }, 400);
      return;
    }

    document.documentElement.classList.remove('needs-auth');
    document.documentElement.classList.add('is-authenticated');
  }

  function showPasswordFailure(message) {
    passwordError.textContent = message || 'Incorrect password. Please try again.';
    passwordError.classList.remove('hidden');
    passwordError.classList.remove('shake');
    void passwordError.offsetWidth;
    passwordError.classList.add('shake');
    passwordInput.value = '';
    passwordInput.focus();
  }

  async function checkDashboardAuthStatus() {
    const response = await fetch('/api/dashboard-auth/status', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error('Failed to verify dashboard access.');
    }

    const data = await response.json();
    return Boolean(data.authenticated);
  }

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
      passwordForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pwd = passwordInput.value;

        try {
          if (passwordSubmitBtn) {
            passwordSubmitBtn.disabled = true;
            passwordSubmitBtn.textContent = 'Verifying...';
          }

          const response = await fetch('/api/dashboard-auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: pwd })
          });
          const data = await response.json().catch(() => ({}));

          if (!response.ok) {
            throw new Error(data.error || 'Incorrect password. Please try again.');
          }

          revealDashboard();
          fetchAttendance();
          fetchSchedule();
        } catch (error) {
          showPasswordFailure(error.message);
        } finally {
          if (passwordSubmitBtn) {
            passwordSubmitBtn.disabled = false;
            passwordSubmitBtn.textContent = 'Verify & Access';
          }
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

  async function fetchSchedule() {
    try {
      const response = await fetch('/api/status');
      if (!response.ok) throw new Error('Failed to fetch schedule');
      const data = await response.json();
      schedulesCache = Array.isArray(data.schedules) ? data.schedules : [];
      attendees = normalizeAttendanceRecords(attendees);
      calculateMetrics();
      if (!isAttendanceLoading) {
        applyFilters();
      }

      if (data.status === 'live' || data.status === 'waiting') {
        if (data.startTime) {
          const startParts = splitIsoToWorkshopDateAndTime(data.startTime);
          scheduleStartDate.value = startParts.date;
          scheduleStartTime.value = startParts.time;
        } else {
          scheduleStartDate.value = '';
          scheduleStartTime.value = '';
        }
        if (data.endTime) {
          const endParts = splitIsoToWorkshopDateAndTime(data.endTime);
          scheduleEndDate.value = endParts.date;
          scheduleEndTime.value = endParts.time;
        } else {
          scheduleEndDate.value = '';
          scheduleEndTime.value = '';
        }
      } else {
        scheduleStartDate.value = '';
        scheduleStartTime.value = '';
        scheduleEndDate.value = '';
        scheduleEndTime.value = '';
      }

      updateStatusPill(data.isLive);

      renderSchedulesList(schedulesCache, data.id, data.isLive);
    } catch (err) {
      console.error('Error fetching schedule:', err);
    }
  }

  function formatScheduleTime(startIso, endIso) {
    const start = new Date(startIso);
    const end = new Date(endIso);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return { dateStr: '-', timeStr: '-', durationStr: '' };
    }

    const dateStr = start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: WORKSHOP_TIMEZONE });
    const startTimeStr = start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: WORKSHOP_TIMEZONE });
    const endTimeStr = end.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: WORKSHOP_TIMEZONE });

    const diffMins = Math.round((end.getTime() - start.getTime()) / 60000);
    let durationStr = '';
    if (diffMins < 60) {
      durationStr = `${diffMins}m`;
    } else {
      const hrs = Math.floor(diffMins / 60);
      const mins = diffMins % 60;
      durationStr = mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
    }

    return { dateStr, timeStr: `${startTimeStr} - ${endTimeStr}`, durationStr };
  }

  function getScheduleStatusBadge(startIso, endIso, id, activeId, isLive) {
    const now = Date.now();
    const start = new Date(startIso).getTime();
    const end = new Date(endIso).getTime();

    if (now >= start && now <= end) {
      return `<span class="status-badge badge-on">Live</span>`;
    } else if (now < start) {
      return `<span class="status-badge badge-certified" style="background: rgba(75, 123, 255, 0.12); color: var(--accent-2);">Upcoming</span>`;
    } else {
      return `<span class="status-badge badge-short" style="background: rgba(18, 32, 51, 0.08); color: var(--muted);">Ended</span>`;
    }
  }

  function renderSchedulesList(schedules, activeId, isLive) {
    const todaysList = document.getElementById('todaysScheduleList');
    const upcomingList = document.getElementById('upcomingScheduleList');
    const pastList = document.getElementById('pastScheduleList');

    if (!todaysList || !upcomingList) return;

    const now = new Date();
    const todayStr = getDateKeyInTimezone(now);

    const todaysSchedules = [];
    const upcomingSchedules = [];
    const pastSchedules = [];

    schedules.forEach(s => {
      const start = new Date(s.startTime);
      const end = new Date(s.endTime);
      const startDayStr = getDateKeyInTimezone(start);
      const endDayStr = getDateKeyInTimezone(end);

      if (startDayStr === todayStr || endDayStr === todayStr) {
        todaysSchedules.push(s);
      } else if (start.getTime() > now.getTime()) {
        upcomingSchedules.push(s);
      } else {
        pastSchedules.push(s);
      }
    });

    // Sort chronologically/reverse-chronologically
    todaysSchedules.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    upcomingSchedules.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
    pastSchedules.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()); // Newest past first

    // Render Today
    if (todaysSchedules.length === 0) {
      todaysList.innerHTML = `
        <div style="color: var(--muted); font-size: 0.88rem; padding: 12px; border: 1px dashed var(--line); border-radius: var(--radius-md); text-align: center; background: rgba(255, 255, 255, 0.25);">
          No schedules set for today.
        </div>
      `;
    } else {
      todaysList.innerHTML = todaysSchedules.map(s => {
        const { dateStr, timeStr, durationStr } = formatScheduleTime(s.startTime, s.endTime);
        const badge = getScheduleStatusBadge(s.startTime, s.endTime, s.id, activeId, isLive);
        return `
          <div class="schedule-item-card" style="display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; background: rgba(255, 255, 255, 0.45); border: 1px solid var(--line); border-radius: var(--radius-md); transition: transform 180ms ease, box-shadow 180ms ease;">
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <span style="font-weight: 700; font-size: 0.9rem; color: var(--text);">${escapeHtml(dateStr)}</span>
              <span style="font-size: 0.8rem; color: var(--muted);">${escapeHtml(timeStr)} (${durationStr})</span>
            </div>
            <div style="display: flex; align-items: center; gap: 12px;">
              ${badge}
              <button class="delete-schedule-btn" data-id="${s.id}" aria-label="Delete schedule" style="background: none; border: none; padding: 6px; cursor: pointer; color: #ef4444; display: flex; align-items: center; transition: color 150ms ease;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
              </button>
            </div>
          </div>
        `;
      }).join('');
    }

    // Render Upcoming
    if (upcomingSchedules.length === 0) {
      upcomingList.innerHTML = `
        <div style="color: var(--muted); font-size: 0.88rem; padding: 12px; border: 1px dashed var(--line); border-radius: var(--radius-md); text-align: center; background: rgba(255, 255, 255, 0.25);">
          No upcoming schedules.
        </div>
      `;
    } else {
      upcomingList.innerHTML = upcomingSchedules.map(s => {
        const { dateStr, timeStr, durationStr } = formatScheduleTime(s.startTime, s.endTime);
        const badge = getScheduleStatusBadge(s.startTime, s.endTime, s.id, activeId, isLive);
        return `
          <div class="schedule-item-card" style="display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; background: rgba(255, 255, 255, 0.45); border: 1px solid var(--line); border-radius: var(--radius-md); transition: transform 180ms ease, box-shadow 180ms ease;">
            <div style="display: flex; flex-direction: column; gap: 4px;">
              <span style="font-weight: 700; font-size: 0.9rem; color: var(--text);">${escapeHtml(dateStr)}</span>
              <span style="font-size: 0.8rem; color: var(--muted);">${escapeHtml(timeStr)} (${durationStr})</span>
            </div>
            <div style="display: flex; align-items: center; gap: 12px;">
              ${badge}
              <button class="delete-schedule-btn" data-id="${s.id}" aria-label="Delete schedule" style="background: none; border: none; padding: 6px; cursor: pointer; color: #ef4444; display: flex; align-items: center; transition: color 150ms ease;">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
              </button>
            </div>
          </div>
        `;
      }).join('');
    }

    // Render Past
    if (pastList) {
      if (pastSchedules.length === 0) {
        pastList.innerHTML = `
          <div style="color: var(--muted); font-size: 0.88rem; padding: 12px; border: 1px dashed var(--line); border-radius: var(--radius-md); text-align: center; background: rgba(255, 255, 255, 0.25);">
            No past schedules.
          </div>
        `;
      } else {
        pastList.innerHTML = pastSchedules.map(s => {
          const { dateStr, timeStr, durationStr } = formatScheduleTime(s.startTime, s.endTime);
          const badge = getScheduleStatusBadge(s.startTime, s.endTime, s.id, activeId, isLive);
          return `
            <div class="schedule-item-card" style="display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; background: rgba(255, 255, 255, 0.45); border: 1px solid var(--line); border-radius: var(--radius-md); transition: transform 180ms ease, box-shadow 180ms ease;">
              <div style="display: flex; flex-direction: column; gap: 4px;">
                <span style="font-weight: 700; font-size: 0.9rem; color: var(--text);">${escapeHtml(dateStr)}</span>
                <span style="font-size: 0.8rem; color: var(--muted);">${escapeHtml(timeStr)} (${durationStr})</span>
              </div>
              <div style="display: flex; align-items: center; gap: 12px;">
                ${badge}
                <button class="delete-schedule-btn" data-id="${s.id}" aria-label="Delete schedule" style="background: none; border: none; padding: 6px; cursor: pointer; color: #ef4444; display: flex; align-items: center; transition: color 150ms ease;">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>
                </button>
              </div>
            </div>
          `;
        }).join('');
      }
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
        showToast('error', 'Missing Fields', 'Please fill in all date and time fields before saving.');
        return;
      }

      const startTime = workshopLocalToIso(startDateVal, startTimeVal);
      const endTime = workshopLocalToIso(endDateVal, endTimeVal);

      if (new Date(startTime) >= new Date(endTime)) {
        showToast('error', 'Invalid Time Range', 'Start time must be before end time.');
        return;
      }

      // Prevent double-submit
      if (saveScheduleBtn.disabled) return;

      try {
        saveScheduleBtn.disabled = true;
        saveScheduleBtn.textContent = 'Saving...';

        const response = await fetch('/api/schedule', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ startTime, endTime })
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          throw new Error(errData.error || `Server error ${response.status}`);
        }

        const data = await response.json();
        if (!data.ok) throw new Error(data.error || 'Schedule was not confirmed by server.');

        showToast('success', 'Schedule Saved!', 'The new schedule has been added successfully.');

        // Clear the form fields so there's no stale data
        scheduleStartDate.value = '';
        scheduleStartTime.value = '';
        scheduleEndDate.value = '';
        scheduleEndTime.value = '';

        // Always re-fetch from server to ensure UI matches actual backend state
        await fetchSchedule();
      } catch (err) {
        console.error('Error saving schedule:', err);
        showToast('error', 'Save Failed', err.message);
      } finally {
        saveScheduleBtn.disabled = false;
        saveScheduleBtn.textContent = 'Save Schedule';
      }
    });
  }

  // Initialize
  setupAuth();
  checkDashboardAuthStatus()
    .then((isAuthenticated) => {
      if (!isAuthenticated) {
        return;
      }

      revealDashboard();
      fetchAttendance();
      fetchSchedule();
    })
    .catch((error) => {
      console.error('Dashboard auth check failed:', error);
    });
});
