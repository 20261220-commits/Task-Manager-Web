// ==== Google 로그인 & Classroom 연동 설정 ====
const GOOGLE_CLIENT_ID = '129092343448-ia5181b8igddi74sloeueapmrcj9emhi.apps.googleusercontent.com';
const GOOGLE_SCOPES = [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/classroom.courses.readonly',
    'https://www.googleapis.com/auth/classroom.coursework.me.readonly',
    'https://www.googleapis.com/auth/classroom.announcements.readonly'
].join(' ');

let accessToken = null;
let tokenClient = null;
const TODAY_DATE_STR = '2026-08-15';

// 로그인 상태 객체
let currentUser = null; 

let rawClassroomPosts = [
    { id: '1', type: 'suhaeng', status: 'todo', subject: '수학', title: '미적분 탐구 보고서 제출', dueDate: '2026-08-20', desc: '실생활 예시 3가지 포함하여 작성' },
    { id: '2', type: 'suhaeng', status: 'todo', subject: '국어', title: '현대시 비평문 작성하기', dueDate: '2026-08-24', desc: '시 2편을 선정하여 비교 분석' },
    { id: '3', type: 'suhaeng', status: 'inprogress', subject: '영어', title: '영미 문학 발표 대본 준비', dueDate: '2026-08-16', desc: '슬라이드 제작 및 발표 대본 완성' },
    { id: '4', type: 'suhaeng', status: 'inprogress', subject: '물리', title: '역학적 에너지 실험 보고서', dueDate: '2026-08-15', desc: '측정 데이터 그래프 첨부' },
    { id: '5', type: 'suhaeng', status: 'done', subject: '화학', title: '산염기 중화적정 보고서', dueDate: '2026-08-10', desc: '클래스룸 제출 완료' },
    { id: '6', type: 'suhaeng', status: 'todo', subject: '한국사', title: '역사적 사건 카드뉴스 제작', dueDate: '2026-08-11', desc: '마감일 경과 항목' },
    { id: '7', type: 'material', subject: '물리', title: '3단원 역학적 에너지 유인물 PDF', date: '2026-08-14', desc: '수업 학습지 자료' },
    { id: '8', type: 'notice', subject: '공통', title: '2학기 1차 지필평가 범위 안내', date: '2026-08-12', desc: '과목별 시험 범위' }
];

let currentTaskForModal = null;

document.addEventListener('DOMContentLoaded', () => {
    initAuth();
    initTodayDate();
    initAccountMenu();
    initViewSwitching();
    initThemeToggle();
    initMainTabs();
    initAddModal();
    renderDashboard();
    renderMaterials();
    renderCalendar();
    initModal();
});

// 1. 로그인/로그아웃 시스템
// 1. 로그인/로그아웃 시스템
function initAuth() {
    const authBtn = document.getElementById('btn-auth-action');

    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: GOOGLE_SCOPES,
        callback: async (response) => {
            if (response.error) {
                console.error('로그인 실패:', response);
                alert('로그인에 실패했어요. 다시 시도해주세요.');
                return;
            }
            accessToken = response.access_token;
            await fetchUserProfile();
            await fetchClassroomData();
        }
    });

    authBtn.addEventListener('click', () => {
        if (!currentUser) {
            tokenClient.requestAccessToken();
        } else {
            // 로그아웃
            if (accessToken) google.accounts.oauth2.revoke(accessToken, () => {});
            accessToken = null;
            currentUser = null;
            updateAuthUI();
        }
    });
}

// 구글 계정 프로필(이름/이메일) 가져오기
async function fetchUserProfile() {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` }
    });
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
                    link: w.alternateLink
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

// 2. 새 수행평가 등록 모달
function initAddModal() {
    const fab = document.getElementById('fab-add-task');
    const addModal = document.getElementById('add-modal');
    const closeBtn = document.getElementById('add-modal-close');
    const form = document.getElementById('add-task-form');

    fab.onclick = () => addModal.style.display = 'block';
    closeBtn.onclick = () => addModal.style.display = 'none';

    form.onsubmit = (e) => {
        e.preventDefault();
        const newTask = {
            id: String(Date.now()),
            type: 'suhaeng',
            status: 'todo',
            subject: document.getElementById('add-subject').value,
            title: document.getElementById('add-title').value,
            dueDate: document.getElementById('add-duedate').value,
            desc: document.getElementById('add-desc').value
        };

        rawClassroomPosts.unshift(newTask);
        renderDashboard();
        renderCalendar();
        form.reset();
        addModal.style.display = 'none';
    };
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

    rawClassroomPosts.filter(p => p.type === 'suhaeng').forEach(task => {
        const ddayInfo = getDDayInfo(task.dueDate);
        const card = createTaskCard(task, ddayInfo);

        if (ddayInfo.isOverdue && task.status !== 'done') { overdueList.appendChild(card.cloneNode(true)); counts.overdue++; }
        if (ddayInfo.isUrgent && task.status !== 'done') { urgentList.appendChild(card.cloneNode(true)); counts.urgent++; }

        if (task.status === 'todo') { todoList.appendChild(card); counts.todo++; }
        else if (task.status === 'inprogress') { inprogressList.appendChild(card); counts.inprogress++; }
        else if (task.status === 'done') { doneList.appendChild(card); counts.done++; }
    });

    document.getElementById('todo-count').innerText = counts.todo;
    document.getElementById('inprogress-count').innerText = counts.inprogress;
    document.getElementById('done-count').innerText = counts.done;
    document.getElementById('urgent-count').innerText = counts.urgent;
    document.getElementById('overdue-count').innerText = counts.overdue;
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
    });
    tabMaterials.addEventListener('click', () => {
        tabMaterials.classList.add('active'); tabSuhaeng.classList.remove('active');
        viewMaterials.classList.add('active'); viewDashboard.classList.remove('active'); viewCalendar.classList.remove('active');
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

function renderCalendar() {
    const container = document.getElementById('calendar-cells');
    if (!container) return;
    container.innerHTML = '';
    for (let day = 1; day <= 31; day++) {
        const cell = document.createElement('div');
        cell.className = 'cal-cell';
        cell.innerHTML = `<span>${day}</span>`;
        const dateStr = `2026-08-${day < 10 ? '0' + day : day}`;
        rawClassroomPosts.filter(t => t.type === 'suhaeng' && t.dueDate === dateStr).forEach(t => {
            const tag = document.createElement('div');
            tag.className = 'cal-task-tag';
            tag.innerText = t.title;
            cell.appendChild(tag);
        });
        container.appendChild(cell);
    }
}

function initModal() {
    const modal = document.getElementById('task-modal');
    const closeBtn = document.getElementById('modal-close');
    const aiBtn = document.getElementById('btn-ai-subtask');
    closeBtn.onclick = () => modal.style.display = 'none';
    window.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
    aiBtn.onclick = () => { if (currentTaskForModal) generateAISubtasks(currentTaskForModal); };
}

function openModal(task) {
    currentTaskForModal = task;
    const modal = document.getElementById('task-modal');
    document.getElementById('modal-subject').innerText = task.subject;
    document.getElementById('modal-title').innerText = task.title;
    document.getElementById('modal-desc').innerText = task.desc || '상세 설명이 없습니다.';
    renderSubtasks(task.id);
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

async function generateAISubtasks(task) {
    const btn = document.getElementById('btn-ai-subtask');
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> AI 생성 중...`;
    setTimeout(() => {
        const generatedPlans = [
            `1. [${task.subject}] 관련 자료 조사 및 개요 작성`,
            `2. 초안 작성 및 핵심 내용 정리`,
            `3. 최종 검토 후 제출`
        ];
        const existing = JSON.parse(localStorage.getItem('subtasks_' + task.id) || '[]');
        const updated = [...existing, ...generatedPlans.map(text => ({ text, done: false }))];
        localStorage.setItem('subtasks_' + task.id, JSON.stringify(updated));
        renderSubtasks(task.id);
        renderDashboard();
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> AI 자동 계획`;
    }, 800);
}