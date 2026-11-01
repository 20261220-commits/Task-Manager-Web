// ==== Google 로그인 & Classroom 연동 설정 ====
const GOOGLE_CLIENT_ID = '129092343448-ia5181b8igddi74sloeueapmrcj9emhi.apps.googleusercontent.com';
const GOOGLE_SCOPES = [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/classroom.courses.readonly',
    'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
    'https://www.googleapis.com/auth/classroom.announcements.readonly'
].join(' ');

// ==== AI(Gemini) 연동 설정 - 무료 티어 사용 ====
// Cloudflare Worker를 배포한 뒤, 발급된 주소로 아래 값을 바꿔주세요.
// 예: https://suhaeng-ai-proxy.본인계정.workers.dev
const AI_WORKER_URL = 'https://suhaeng-ai-proxy.studyinthis.workers.dev/';

let accessToken = null;
const TODAY_DATE_STR = '2026-08-15';

// 로그인 상태 객체
let currentUser = null; 

let rawClassroomPosts = [
    { id: '1', type: 'suhaeng', status: 'todo', subject: '수학', title: '미적분 탐구 보고서 제출', dueDate: '2026-08-20', desc: '실생활 예시 3가지 포함하여 작성', materials: [
        { type: 'file', title: '보고서_양식.hwp', url: 'https://example.com/form.hwp' },
        { type: 'link', title: '참고 사이트', url: 'https://example.com' }
    ] },
    { id: '2', type: 'suhaeng', status: 'todo', subject: '국어', title: '현대시 비평문 작성하기', dueDate: '2026-08-24', desc: '시 2편을 선정하여 비교 분석' },
    { id: '3', type: 'suhaeng', status: 'inprogress', subject: '영어', title: '영미 문학 발표 대본 준비', dueDate: '2026-08-16', desc: '슬라이드 제작 및 발표 대본 완성', materials: [
        { type: 'youtube', title: '발표 예시 영상', url: 'https://youtube.com' }
    ] },
    { id: '4', type: 'suhaeng', status: 'inprogress', subject: '물리', title: '역학적 에너지 실험 보고서', dueDate: '2026-08-15', desc: '측정 데이터 그래프 첨부' },
    { id: '5', type: 'suhaeng', status: 'done', subject: '화학', title: '산염기 중화적정 보고서', dueDate: '2026-08-10', desc: '클래스룸 제출 완료' },
    { id: '6', type: 'suhaeng', status: 'todo', subject: '한국사', title: '역사적 사건 카드뉴스 제작', dueDate: '2026-08-11', desc: '마감일 경과 항목' },
    { id: '7', type: 'material', subject: '물리', title: '3단원 역학적 에너지 유인물 PDF', date: '2026-08-14', desc: '수업 학습지 자료' },
    { id: '8', type: 'notice', subject: '공통', title: '2학기 1차 지필평가 범위 안내', date: '2026-08-12', desc: '과목별 시험 범위' }
];

let currentTaskForModal = null;
let filterState = { search: '', subject: 'all', sort: 'dueDate' };
let calendarDate = new Date(TODAY_DATE_STR + 'T00:00:00');

document.addEventListener('DOMContentLoaded', () => {
    initAuth();
    initTodayDate();
    initAccountMenu();
    initViewSwitching();
    initThemeToggle();
    initMainTabs();
    initAddModal();
    initFilterBar();
    initCalendarNav();
    initTabBadgeTracking();
    renderDashboard();
    renderMaterials();
    renderCalendar();
    initModal();
});

// 1. 로그인/로그아웃 시스템
// 팝업 창 대신, 앱 창 자체가 구글 로그인 페이지로 이동했다가 로그인 후 돌아오는 방식(리디렉션)입니다.
// ※ Google Cloud Console의 OAuth 클라이언트 → "승인된 리디렉션 URI"에 아래 REDIRECT_URI 주소가 등록되어 있어야 합니다.
//   예: https://20261220-commits.github.io/Task-Manager-Web/
const REDIRECT_URI = location.origin + location.pathname.replace(/index\.html$/, '');
const TOKEN_KEY = 'google_access_token';

function startGoogleLogin() {
    const state = crypto.randomUUID();
    sessionStorage.setItem('oauth_state', state);
    const params = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        response_type: 'token',
        scope: GOOGLE_SCOPES,
        state,
        include_granted_scopes: 'true',
        prompt: 'select_account'
    });
    location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + params;
}

// 로그인 페이지에서 돌아왔을 때 주소 뒤의 #access_token=... 을 읽고, 주소창에서 지웁니다.
function readLoginResult() {
    const hash = location.hash;
    if (!hash.includes('access_token=') && !hash.includes('error=')) return;
    const p = new URLSearchParams(hash.slice(1));
    history.replaceState(null, '', location.pathname + location.search);

    const expected = sessionStorage.getItem('oauth_state');
    sessionStorage.removeItem('oauth_state');
    if (p.get('error')) {
        if (p.get('error') !== 'access_denied') alert('로그인에 실패했어요. 다시 시도해주세요.');
        return;
    }
    if (!expected || p.get('state') !== expected) {
        alert('로그인 확인에 실패했어요. 다시 시도해주세요.');
        return;
    }
    const expiresAt = Date.now() + (Number(p.get('expires_in')) || 3600) * 1000;
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token: p.get('access_token'), expiresAt }));
}

// 이 창에서 이미 로그인했고 토큰이 아직 유효하면 불러옵니다(새로고침해도 로그인 유지).
function loadSavedToken() {
    try {
        const saved = JSON.parse(sessionStorage.getItem(TOKEN_KEY));
        if (saved && saved.expiresAt - 60000 > Date.now()) return saved.token;
    } catch (e) {}
    sessionStorage.removeItem(TOKEN_KEY);
    return null;
}

function initAuth() {
    const authBtn = document.getElementById('btn-auth-action');

    authBtn.addEventListener('click', () => {
        if (!currentUser) {
            startGoogleLogin();
        } else {
            // 로그아웃
            if (accessToken) {
                fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(accessToken), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
                }).catch(() => {});
            }
            sessionStorage.removeItem(TOKEN_KEY);
            accessToken = null;
            currentUser = null;
            updateAuthUI();
        }
    });

    readLoginResult();
    accessToken = loadSavedToken();
    if (accessToken) {
        fetchUserProfile()
            .then(() => fetchClassroomData())
            .catch((err) => {
                console.error('로그인 정보 불러오기 실패:', err);
                sessionStorage.removeItem(TOKEN_KEY);
                accessToken = null;
                currentUser = null;
                updateAuthUI();
            });
    }
}

// 구글 계정 프로필(이름/이메일) 가져오기
async function fetchUserProfile() {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!res.ok) throw new Error('프로필 요청 실패: ' + res.status);
    const profile = await res.json();
    currentUser = { name: profile.name, email: profile.email };
    updateAuthUI();
}

// Classroom 과제/공지 가져와서 rawClassroomPosts 채우기
async function fetchClassroomData() {
    try {
        const coursesRes = await fetch('https://classroom.googleapis.com/v1/courses?courseStates=ACTIVE', {
            headers: { Authorization: `Bearer ${accessToken}` }
        });
        const coursesData = await coursesRes.json();
        const courses = coursesData.courses || [];

        const newPosts = [];

        for (const course of courses) {
            // 과제(수행평가)
            const workRes = await fetch(
                `https://classroom.googleapis.com/v1/courses/${course.id}/courseWork`,
                { headers: { Authorization: `Bearer ${accessToken}` } }
            );
            const workData = await workRes.json();
            (workData.courseWork || []).forEach(w => {
                let dueDate = null;
                if (w.dueDate) {
                    const { year, month, day } = w.dueDate;
                    dueDate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                }
                newPosts.push({
                    id: w.id,
                    type: 'suhaeng',
                    status: 'todo',
                    subject: course.name,
                    title: w.title,
                    dueDate: dueDate || TODAY_DATE_STR,
                    desc: w.description || '',
                    link: w.alternateLink,
                    materials: (w.materials || []).map(m => {
                        if (m.driveFile) return { type: 'file', title: m.driveFile.driveFile.title, url: m.driveFile.driveFile.alternateLink };
                        if (m.link) return { type: 'link', title: m.link.title || m.link.url, url: m.link.url };
                        if (m.youTubeVideo) return { type: 'youtube', title: m.youTubeVideo.title, url: m.youTubeVideo.alternateLink };
                        if (m.form) return { type: 'form', title: m.form.title, url: m.form.formUrl };
                        return null;
                    }).filter(Boolean)
                });
            });

            // 공지사항
            const annRes = await fetch(
                `https://classroom.googleapis.com/v1/courses/${course.id}/announcements`,
                { headers: { Authorization: `Bearer ${accessToken}` } }
            );
            const annData = await annRes.json();
            (annData.announcements || []).forEach(a => {
                newPosts.push({
                    id: a.id,
                    type: 'notice',
                    subject: course.name,
                    title: (a.text || '').slice(0, 40),
                    date: a.creationTime ? a.creationTime.slice(0, 10) : TODAY_DATE_STR,
                    desc: a.text || '',
                    link: a.alternateLink
                });
            });
        }

        if (newPosts.length > 0) {
            rawClassroomPosts = newPosts;
        }

        populateSubjectFilter();
        renderDashboard();
        renderMaterials();
        renderCalendar();
    } catch (err) {
        console.error('Classroom 데이터 로드 실패:', err);
        alert('클래스룸 데이터를 가져오는 데 실패했어요. 콘솔을 확인해주세요.');
    }
}

function updateAuthUI() {
    const nameText = document.getElementById('account-name-text');
    const dispName = document.getElementById('user-display-name');
    const dispEmail = document.getElementById('user-display-email');
    const authBtn = document.getElementById('btn-auth-action');

    if (currentUser) {
        nameText.innerText = currentUser.name;
        dispName.innerText = currentUser.name;
        dispEmail.innerText = currentUser.email;
        authBtn.className = 'auth-action-btn logout';
        authBtn.innerHTML = `<i class="fa-solid fa-right-from-bracket"></i> 로그아웃`;
    } else {
        nameText.innerText = '게스트 (로그인 필요)';
        dispName.innerText = '게스트 사용자';
        dispEmail.innerText = '로그인이 필요합니다.';
        authBtn.className = 'auth-action-btn login';
        authBtn.innerHTML = `<i class="fa-solid fa-right-to-bracket"></i> 구글 계정으로 로그인`;
    }
}

// 2. 새 수행평가 등록 / 수정 모달
function initAddModal() {
    const fab = document.getElementById('fab-add-task');
    const addModal = document.getElementById('add-modal');
    const closeBtn = document.getElementById('add-modal-close');
    const form = document.getElementById('add-task-form');

    fab.onclick = () => {
        resetAddForm();
        addModal.style.display = 'block';
    };
    closeBtn.onclick = () => {
        addModal.style.display = 'none';
        resetAddForm();
    };

    form.onsubmit = (e) => {
        e.preventDefault();
        const editingId = document.getElementById('add-task-id').value;
        const subject = document.getElementById('add-subject').value;
        const title = document.getElementById('add-title').value;
        const dueDate = document.getElementById('add-duedate').value;
        const desc = document.getElementById('add-desc').value;

        if (editingId) {
            const task = rawClassroomPosts.find(t => t.id === editingId);
            if (task) {
                task.subject = subject;
                task.title = title;
                task.dueDate = dueDate;
                task.desc = desc;
            }
        } else {
            const newTask = {
                id: String(Date.now()),
                type: 'suhaeng',
                status: 'todo',
                subject, title, dueDate, desc
            };
            rawClassroomPosts.unshift(newTask);
        }

        populateSubjectFilter();
        renderDashboard();
        renderCalendar();
        resetAddForm();
        addModal.style.display = 'none';
    };
}

function resetAddForm() {
    document.getElementById('add-task-id').value = '';
    document.getElementById('add-task-form').reset();
    document.getElementById('add-modal-title').innerText = '새 수행평가 등록';
    document.getElementById('add-submit-btn').innerText = '등록하기';
}

function openEditModal(task) {
    document.getElementById('add-task-id').value = task.id;
    document.getElementById('add-subject').value = task.subject;
    document.getElementById('add-title').value = task.title;
    document.getElementById('add-duedate').value = task.dueDate;
    document.getElementById('add-desc').value = task.desc || '';
    document.getElementById('add-modal-title').innerText = '수행평가 수정';
    document.getElementById('add-submit-btn').innerText = '수정 완료';
    document.getElementById('add-modal').style.display = 'block';
}

// 3. 진척도 계산 포함 카드 생성
function createTaskCard(task, ddayInfo) {
    const card = document.createElement('div');
    card.className = 'task-item-card';
    card.onclick = () => openModal(task);

    const subtasks = JSON.parse(localStorage.getItem('subtasks_' + task.id) || '[]');
    const total = subtasks.length;
    const completed = subtasks.filter(s => s.done).length;
    const progressPercent = total > 0 ? Math.round((completed / total) * 100) : 0;

    card.innerHTML = `
        <div class="task-item-head">
            <span class="subject-badge">${task.subject}</span>
            <span class="dday-badge ${ddayInfo.type}">${ddayInfo.text}</span>
        </div>
        <div class="task-item-title">${task.title}</div>
        ${task.materials && task.materials.length > 0 ? `
            <div class="task-attachments">
                ${task.materials.map(m => `
                    <a href="${m.url}" target="_blank" class="attachment-chip" onclick="event.stopPropagation()">
                        <i class="${getAttachmentIcon(m.type)}"></i>${m.title}
                    </a>
                `).join('')}
            </div>
        ` : ''}
        ${total > 0 ? `
            <div class="progress-container">
                <div class="progress-bar" id="prog-${task.id}"></div>
            </div>
        ` : ''}
    `;

    // 카드가 DOM에 추가된 후 애니메이션으로 width를 채움
    setTimeout(() => {
        const bar = card.querySelector(`#prog-${task.id}`);
        if (bar) bar.style.width = `${progressPercent}%`;
    }, 50);

    return card;
}

/* 기존 유틸리티 함수 유지 */
function initTodayDate() {
    const todayElem = document.getElementById('today-date-text');
    if (!todayElem) return;
    const date = new Date(TODAY_DATE_STR);
    const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
    todayElem.innerText = `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')} (${weekdays[date.getDay()]})`;
}

function getAttachmentIcon(type) {
    switch (type) {
        case 'link': return 'fa-solid fa-link';
        case 'youtube': return 'fa-brands fa-youtube';
        case 'form': return 'fa-solid fa-list-check';
        case 'file':
        default: return 'fa-solid fa-file-lines';
    }
}

function getDDayInfo(dueDateStr) {
    const today = new Date(TODAY_DATE_STR + 'T00:00:00');
    const target = new Date(dueDateStr + 'T00:00:00');
    const diffDays = Math.round((target - today) / (1000 * 60 * 60 * 24));
    if (diffDays === 0) return { text: 'D-Day', type: 'urgent', isUrgent: true, isOverdue: false };
    if (diffDays > 0) return { text: `D-${diffDays}`, type: diffDays <= 2 ? 'urgent' : 'normal', isUrgent: diffDays <= 2, isOverdue: false };
    return { text: `D+${Math.abs(diffDays)}`, type: 'overdue', isUrgent: false, isOverdue: true };
}

function renderDashboard() {
    const todoList = document.getElementById('todo-list');
    const inprogressList = document.getElementById('inprogress-list');
    const doneList = document.getElementById('done-list');
    const urgentList = document.getElementById('urgent-list');
    const overdueList = document.getElementById('overdue-list');

    todoList.innerHTML = ''; inprogressList.innerHTML = ''; doneList.innerHTML = ''; urgentList.innerHTML = ''; overdueList.innerHTML = '';
    let counts = { todo: 0, inprogress: 0, done: 0, urgent: 0, overdue: 0 };

    const tasks = getFilteredSortedTasks();

    tasks.forEach(task => {
        const ddayInfo = getDDayInfo(task.dueDate);
        const card = createTaskCard(task, ddayInfo);

        if (ddayInfo.isOverdue && task.status !== 'done') { overdueList.appendChild(card.cloneNode(true)); counts.overdue++; }
        if (ddayInfo.isUrgent && task.status !== 'done') { urgentList.appendChild(card.cloneNode(true)); counts.urgent++; }

        if (task.status === 'todo') { todoList.appendChild(card); counts.todo++; }
        else if (task.status === 'inprogress') { inprogressList.appendChild(card); counts.inprogress++; }
        else if (task.status === 'done') { doneList.appendChild(card); counts.done++; }
    });

    if (tasks.length === 0) {
        todoList.innerHTML = '<p class="empty-state">조건에 맞는 수행평가가 없어요.</p>';
    }

    document.getElementById('todo-count').innerText = counts.todo;
    document.getElementById('inprogress-count').innerText = counts.inprogress;
    document.getElementById('done-count').innerText = counts.done;
    document.getElementById('urgent-count').innerText = counts.urgent;
    document.getElementById('overdue-count').innerText = counts.overdue;
    updateTabBadges();
}

// 검색/필터/정렬 상태에 맞게 수행평가 목록 반환
function getFilteredSortedTasks() {
    let tasks = rawClassroomPosts.filter(p => p.type === 'suhaeng');

    if (filterState.search.trim()) {
        const q = filterState.search.trim().toLowerCase();
        tasks = tasks.filter(t => t.title.toLowerCase().includes(q) || t.subject.toLowerCase().includes(q));
    }

    if (filterState.subject !== 'all') {
        tasks = tasks.filter(t => t.subject === filterState.subject);
    }

    if (filterState.sort === 'dueDate') {
        tasks = tasks.slice().sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    } else if (filterState.sort === 'subject') {
        tasks = tasks.slice().sort((a, b) => a.subject.localeCompare(b.subject, 'ko'));
    }
    // 'recent'는 등록 시 배열 맨 앞에 추가되므로 별도 정렬 없이 원래 순서 유지

    return tasks;
}

function populateSubjectFilter() {
    const select = document.getElementById('filter-subject');
    if (!select) return;
    const subjects = [...new Set(rawClassroomPosts.filter(p => p.type === 'suhaeng').map(t => t.subject))];
    const current = select.value;
    select.innerHTML = '<option value="all">전체 과목</option>' + subjects.map(s => `<option value="${s}">${s}</option>`).join('');
    if (subjects.includes(current)) select.value = current;
}

function initFilterBar() {
    const searchInput = document.getElementById('search-input');
    const subjectSelect = document.getElementById('filter-subject');
    const sortSelect = document.getElementById('sort-select');

    searchInput.addEventListener('input', (e) => {
        filterState.search = e.target.value;
        renderDashboard();
    });
    subjectSelect.addEventListener('change', (e) => {
        filterState.subject = e.target.value;
        renderDashboard();
    });
    sortSelect.addEventListener('change', (e) => {
        filterState.sort = e.target.value;
        renderDashboard();
    });

    populateSubjectFilter();
}

function renderMaterials() {
    const container = document.getElementById('materials-list');
    if (!container) return;
    const materials = rawClassroomPosts.filter(p => p.type === 'material' || p.type === 'notice');
    container.innerHTML = materials.map(item => `
        <div class="material-card">
            <span class="mat-type">${item.type === 'material' ? '📄 유인물' : '📢 공지사항'}</span>
            <strong style="font-size:0.92rem; color:var(--text-primary);">[${item.subject}] ${item.title}</strong>
            <p style="font-size:0.82rem; color:var(--text-secondary); line-height:1.4;">${item.desc}</p>
            <span style="font-size:0.75rem; color:var(--text-tertiary); margin-top: auto;">게시일: ${item.date}</span>
        </div>
    `).join('');
    updateTabBadges();
}

/* ==== 새 글 알림 뱃지 ==== */
function getSeenIds(key) {
    return new Set(JSON.parse(localStorage.getItem(key) || '[]'));
}

function markSeen(key, ids) {
    const seen = getSeenIds(key);
    ids.forEach(id => seen.add(id));
    localStorage.setItem(key, JSON.stringify([...seen]));
}

function setTabBadge(tabId, count) {
    const tab = document.getElementById(tabId);
    if (!tab) return;
    let badge = tab.querySelector('.tab-badge');
    if (count > 0) {
        if (!badge) {
            badge = document.createElement('span');
            badge.className = 'tab-badge';
            tab.appendChild(badge);
        }
        badge.innerText = count > 9 ? '9+' : count;
    } else if (badge) {
        badge.remove();
    }
}

function updateTabBadges() {
    const suhaengIds = rawClassroomPosts.filter(p => p.type === 'suhaeng').map(p => p.id);
    const materialIds = rawClassroomPosts.filter(p => p.type === 'material' || p.type === 'notice').map(p => p.id);

    const seenSuhaeng = getSeenIds('seenSuhaengIds');
    const seenMaterial = getSeenIds('seenMaterialIds');

    const newSuhaengCount = suhaengIds.filter(id => !seenSuhaeng.has(id)).length;
    const newMaterialCount = materialIds.filter(id => !seenMaterial.has(id)).length;

    setTabBadge('tab-suhaeng', newSuhaengCount);
    setTabBadge('tab-materials', newMaterialCount);
}

// 최초 방문 시엔 지금 데이터를 전부 '이미 봄' 처리해서 뱃지가 뜨지 않게 하고,
// 이후 새로 추가되는 항목(클래스룸 동기화, 수동 등록 등)만 새 글로 표시
function initTabBadgeTracking() {
    if (localStorage.getItem('seenSuhaengIds') === null) {
        markSeen('seenSuhaengIds', rawClassroomPosts.filter(p => p.type === 'suhaeng').map(p => p.id));
    }
    if (localStorage.getItem('seenMaterialIds') === null) {
        markSeen('seenMaterialIds', rawClassroomPosts.filter(p => p.type === 'material' || p.type === 'notice').map(p => p.id));
    }
}

function initMainTabs() {
    const tabSuhaeng = document.getElementById('tab-suhaeng');
    const tabMaterials = document.getElementById('tab-materials');
    const viewDashboard = document.getElementById('view-dashboard');
    const viewMaterials = document.getElementById('view-materials');
    const viewCalendar = document.getElementById('view-calendar');

    tabSuhaeng.addEventListener('click', () => {
        tabSuhaeng.classList.add('active'); tabMaterials.classList.remove('active');
        viewDashboard.classList.add('active'); viewMaterials.classList.remove('active'); viewCalendar.classList.remove('active');
        markSeen('seenSuhaengIds', rawClassroomPosts.filter(p => p.type === 'suhaeng').map(p => p.id));
        updateTabBadges();
    });
    tabMaterials.addEventListener('click', () => {
        tabMaterials.classList.add('active'); tabSuhaeng.classList.remove('active');
        viewMaterials.classList.add('active'); viewDashboard.classList.remove('active'); viewCalendar.classList.remove('active');
        markSeen('seenMaterialIds', rawClassroomPosts.filter(p => p.type === 'material' || p.type === 'notice').map(p => p.id));
        updateTabBadges();
    });
}

function initAccountMenu() {
    const accountBtn = document.getElementById('account-btn');
    const dropdown = document.getElementById('account-dropdown');
    accountBtn.addEventListener('click', (e) => { e.stopPropagation(); dropdown.classList.toggle('show'); });
    document.addEventListener('click', (e) => { if (!dropdown.contains(e.target) && !accountBtn.contains(e.target)) dropdown.classList.remove('show'); });
}

function initViewSwitching() {
    const btnDashboard = document.getElementById('btn-view-dashboard');
    const btnCalendar = document.getElementById('btn-view-calendar');
    const viewDashboard = document.getElementById('view-dashboard');
    const viewCalendar = document.getElementById('view-calendar');
    const viewMaterials = document.getElementById('view-materials');

    btnDashboard.addEventListener('click', () => {
        btnDashboard.classList.add('active'); btnCalendar.classList.remove('active');
        viewDashboard.classList.add('active'); viewCalendar.classList.remove('active'); viewMaterials.classList.remove('active');
    });
    btnCalendar.addEventListener('click', () => {
        btnCalendar.classList.add('active'); btnDashboard.classList.remove('active');
        viewCalendar.classList.add('active'); viewDashboard.classList.remove('active'); viewMaterials.classList.remove('active');
    });
}

function initThemeToggle() {
    const themeBtn = document.getElementById('btn-theme-toggle');
    if (localStorage.getItem('theme') === 'dark') document.body.classList.add('dark-mode');
    themeBtn.addEventListener('click', () => {
        const isDark = document.body.classList.toggle('dark-mode');
        localStorage.setItem('theme', isDark ? 'dark' : 'light');
    });
}

function initCalendarNav() {
    const prevBtn = document.getElementById('btn-cal-prev');
    const nextBtn = document.getElementById('btn-cal-next');
    if (!prevBtn || !nextBtn) return;

    prevBtn.addEventListener('click', () => {
        calendarDate.setMonth(calendarDate.getMonth() - 1);
        renderCalendar();
    });
    nextBtn.addEventListener('click', () => {
        calendarDate.setMonth(calendarDate.getMonth() + 1);
        renderCalendar();
    });
}

function renderCalendar() {
    const container = document.getElementById('calendar-cells');
    const titleEl = document.getElementById('calendar-title');
    if (!container) return;

    const year = calendarDate.getFullYear();
    const month = calendarDate.getMonth(); // 0-indexed
    if (titleEl) titleEl.innerText = `📅 ${year}년 ${month + 1}월 수행평가 일정`;

    container.innerHTML = '';

    const firstWeekday = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let i = 0; i < firstWeekday; i++) {
        const empty = document.createElement('div');
        empty.className = 'cal-cell empty';
        container.appendChild(empty);
    }

    for (let day = 1; day <= daysInMonth; day++) {
        const cell = document.createElement('div');
        cell.className = 'cal-cell';
        cell.innerHTML = `<span>${day}</span>`;
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        rawClassroomPosts.filter(t => t.type === 'suhaeng' && t.dueDate === dateStr).forEach(t => {
            const tag = document.createElement('div');
            tag.className = 'cal-task-tag';
            tag.innerText = t.title;
            tag.onclick = () => openModal(t);
            cell.appendChild(tag);
        });
        container.appendChild(cell);
    }
}

function initModal() {
    const modal = document.getElementById('task-modal');
    const closeBtn = document.getElementById('modal-close');
    const aiBtn = document.getElementById('btn-ai-subtask');
    const topicBtn = document.getElementById('btn-ai-topic');
    const editBtn = document.getElementById('btn-edit-task');
    const deleteBtn = document.getElementById('btn-delete-task');
    const statusButtons = document.querySelectorAll('.status-btn');

    closeBtn.onclick = () => modal.style.display = 'none';
    window.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
    aiBtn.onclick = () => { if (currentTaskForModal) generateAISubtasks(currentTaskForModal); };
    if (topicBtn) topicBtn.onclick = () => { if (currentTaskForModal) generateTopicSuggestions(currentTaskForModal); };

    editBtn.onclick = () => {
        if (currentTaskForModal) {
            modal.style.display = 'none';
            openEditModal(currentTaskForModal);
        }
    };

    deleteBtn.onclick = () => {
        if (currentTaskForModal && confirm(`'${currentTaskForModal.title}' 항목을 삭제할까요?`)) {
            deleteTask(currentTaskForModal.id);
            modal.style.display = 'none';
        }
    };

    statusButtons.forEach(btn => {
        btn.onclick = () => {
            if (currentTaskForModal) {
                updateTaskStatus(currentTaskForModal.id, btn.dataset.status);
                highlightStatusButton(btn.dataset.status);
            }
        };
    });
}

function highlightStatusButton(status) {
    document.querySelectorAll('.status-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.status === status);
    });
}

function updateTaskStatus(taskId, newStatus) {
    const task = rawClassroomPosts.find(t => t.id === taskId);
    if (!task) return;
    task.status = newStatus;
    if (currentTaskForModal && currentTaskForModal.id === taskId) currentTaskForModal.status = newStatus;
    renderDashboard();
    renderCalendar();
}

function deleteTask(taskId) {
    rawClassroomPosts = rawClassroomPosts.filter(t => t.id !== taskId);
    localStorage.removeItem('subtasks_' + taskId);
    populateSubjectFilter();
    renderDashboard();
    renderCalendar();
}

function openModal(task) {
    currentTaskForModal = task;
    const modal = document.getElementById('task-modal');
    document.getElementById('modal-subject').innerText = task.subject;
    document.getElementById('modal-title').innerText = task.title;
    document.getElementById('modal-desc').innerText = task.desc || '상세 설명이 없습니다.';

    // 첨부 자료 렌더링
    const attachContainer = document.getElementById('modal-attachments');
    if (task.materials && task.materials.length > 0) {
        attachContainer.innerHTML = task.materials.map(m => `
            <a href="${m.url}" target="_blank" class="modal-attachment-item">
                <i class="${getAttachmentIcon(m.type)}"></i>${m.title}
            </a>
        `).join('');
    } else {
        attachContainer.innerHTML = '';
    }

    const linkEl = document.getElementById('modal-link');
    if (task.link) {
        linkEl.href = task.link;
        linkEl.style.display = 'flex';
    } else {
        linkEl.style.display = 'none';
    }

    highlightStatusButton(task.status);
    renderSubtasks(task.id);

    // 이전 과제에서 뜬 AI 주제 추천 결과 초기화
    // (주제 추천 칸이 화면에 없으면 건너뜀)
    const topicPanel = document.getElementById('ai-topic-panel');
    const topicResults = document.getElementById('ai-topic-results');
    if (topicResults) topicResults.innerHTML = '';
    if (topicPanel) topicPanel.classList.remove('show');

    modal.style.display = 'block';

    document.getElementById('btn-add-subtask').onclick = () => {
        const input = document.getElementById('subtask-input');
        if (input.value.trim()) {
            addSubtask(task.id, input.value.trim());
            input.value = '';
        }
    };
}

function renderSubtasks(taskId) {
    const list = document.getElementById('modal-subtask-list');
    const subtasks = JSON.parse(localStorage.getItem('subtasks_' + taskId) || '[]');
    list.innerHTML = subtasks.length ? subtasks.map((st, i) => `
        <div class="subtask-item">
            <input type="checkbox" ${st.done ? 'checked' : ''} onchange="toggleSubtask('${taskId}', ${i})">
            <span style="${st.done ? 'text-decoration: line-through; opacity:0.5;' : ''}">${st.text}</span>
        </div>
    `).join('') : '<p style="color:var(--text-tertiary); font-size:0.85rem;">등록된 세부 단계가 없습니다.</p>';
}

function addSubtask(taskId, text) {
    const subtasks = JSON.parse(localStorage.getItem('subtasks_' + taskId) || '[]');
    subtasks.push({ text, done: false });
    localStorage.setItem('subtasks_' + taskId, JSON.stringify(subtasks));
    renderSubtasks(taskId);
    renderDashboard();
}

function toggleSubtask(taskId, index) {
    const subtasks = JSON.parse(localStorage.getItem('subtasks_' + taskId));
    subtasks[index].done = !subtasks[index].done;
    localStorage.setItem('subtasks_' + taskId, JSON.stringify(subtasks));
    renderSubtasks(taskId);
    renderDashboard();
}

// Cloudflare Worker를 통해 Gemini API 호출 (로그인된 사용자만 가능, 완전 무료)
async function callAI(userPrompt, maxTokens = 500) {
    if (!accessToken) {
        throw new Error('AI 기능을 사용하려면 먼저 구글 계정으로 로그인해주세요.');
    }
    if (AI_WORKER_URL.includes('YOUR-WORKER-NAME')) {
        throw new Error('AI 서버 주소가 아직 설정되지 않았어요. app.js의 AI_WORKER_URL을 확인해주세요.');
    }

    const res = await fetch(AI_WORKER_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({ prompt: userPrompt, maxTokens })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(data.error || `AI 요청에 실패했어요. (${res.status})`);
    }
    return data.text || '';
}

// AI 응답 텍스트를 줄 단위 목록으로 정리 (번호, 기호 등 제거)
function parseAiListResponse(text) {
    return text
        .split('\n')
        .map(line => line.replace(/^[\s\-*•\d.)]+/, '').trim())
        .filter(Boolean);
}

async function generateAISubtasks(task) {
    const btn = document.getElementById('btn-ai-subtask');
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> AI 생성 중...`;

    try {
        const prompt = `학생이 아래 수행평가를 준비하고 있어요. 이 과제를 완료하기 위한 단계별 체크리스트를 3~5개 항목으로 만들어주세요.
각 항목은 한 줄로, 번호나 기호 없이 실행 가능한 할 일 형태로 작성하고, 항목마다 줄바꿈으로만 구분해주세요.
다른 설명이나 인사말 없이 목록만 출력하세요.

과목: ${task.subject}
제목: ${task.title}
설명: ${task.desc || '설명 없음'}
마감일: ${task.dueDate}`;

        const resultText = await callAI(prompt, 400);
        const plans = parseAiListResponse(resultText);

        if (plans.length === 0) throw new Error('AI가 계획을 생성하지 못했어요.');

        const existing = JSON.parse(localStorage.getItem('subtasks_' + task.id) || '[]');
        const updated = [...existing, ...plans.map(text => ({ text, done: false }))];
        localStorage.setItem('subtasks_' + task.id, JSON.stringify(updated));
        renderSubtasks(task.id);
        renderDashboard();
    } catch (err) {
        console.error('AI 계획 생성 실패:', err);
        alert(err.message || 'AI 계획 생성에 실패했어요. 잠시 후 다시 시도해주세요.');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}

async function generateTopicSuggestions(task) {
    const btn = document.getElementById('btn-ai-topic');
    const panel = document.getElementById('ai-topic-panel');
    const resultsEl = document.getElementById('ai-topic-results');
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> 생성 중...`;

    try {
        const prompt = `학생이 아래 수행평가에 어떤 주제나 방향으로 접근하면 좋을지 궁금해해요.
창의적이고 구체적인 주제 아이디어를 4개 제안해주세요.
각 아이디어는 한 줄로, 번호나 기호 없이 간결하게 작성하고 줄바꿈으로만 구분해주세요.
다른 설명이나 인사말 없이 목록만 출력하세요.

과목: ${task.subject}
과제 제목: ${task.title}
설명: ${task.desc || '설명 없음'}`;

        const resultText = await callAI(prompt, 400);
        const topics = parseAiListResponse(resultText);

        if (topics.length === 0) throw new Error('AI가 주제를 생성하지 못했어요.');

        resultsEl.innerHTML = topics.map(t => `
            <div class="ai-topic-item"><i class="fa-solid fa-sparkles"></i><span>${t}</span></div>
        `).join('');
        panel.classList.add('show');
    } catch (err) {
        console.error('주제 추천 실패:', err);
        alert(err.message || '주제 추천에 실패했어요. 잠시 후 다시 시도해주세요.');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHtml;
    }
}
