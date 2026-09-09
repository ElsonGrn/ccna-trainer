(function () {
  'use strict';

  var LS_KEY = 'ccnaExam.session';
  var DURATION_MIN = 150;
  var TOTAL_QUESTIONS = EXAM_DATA.length;

  var BY_ID = {};
  EXAM_DATA.forEach(function (q) { BY_ID[q.id] = q; });

  var TOPICS = [];
  EXAM_DATA.forEach(function (q) {
    if (TOPICS.indexOf(q.topic) === -1) TOPICS.push(q.topic);
  });

  var root = document.getElementById('app');
  var timerHandle = null;
  var matchOptionOrderCache = {};

  // ---------- persistence ----------

  function loadSession() {
    var raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  function saveSession(session) {
    localStorage.setItem(LS_KEY, JSON.stringify(session));
  }

  function clearSession() {
    localStorage.removeItem(LS_KEY);
  }

  function shuffledIds() {
    var ids = EXAM_DATA.map(function (q) { return q.id; });
    for (var i = ids.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = ids[i]; ids[i] = ids[j]; ids[j] = tmp;
    }
    return ids;
  }

  function newSession() {
    var session = {
      order: shuffledIds(),
      answers: {},
      flagged: [],
      startedAt: Date.now(),
      durationMin: DURATION_MIN,
      currentPos: 0,
      finished: false,
      submittedAt: null
    };
    saveSession(session);
    return session;
  }

  function remainingSeconds(session) {
    var total = session.durationMin * 60;
    var elapsed = Math.floor((Date.now() - session.startedAt) / 1000);
    return Math.max(0, total - elapsed);
  }

  function fmtTime(sec) {
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  // ---------- grading ----------

  function isAnswered(session, id) {
    var a = session.answers[id];
    var q = BY_ID[id];
    if (!a) return false;
    if (q.type === 'match') return Object.keys(a).length > 0;
    return a.length > 0;
  }

  function isCorrect(session, id) {
    var q = BY_ID[id];
    var a = session.answers[id];
    if (!a) return false;
    if (q.type === 'match') {
      for (var i = 0; i < q.pairs.length; i++) {
        var p = q.pairs[i];
        if (a[p.n] !== p.term) return false;
      }
      return true;
    }
    var sel = a.slice().sort().join(',');
    var correct = q.correct.slice().sort().join(',');
    return sel === correct;
  }

  function computeResults(session) {
    var total = EXAM_DATA.length;
    var correctCount = 0;
    var wrongIds = [];
    var unansweredIds = [];
    var perTopic = {};
    TOPICS.forEach(function (t) { perTopic[t] = { correct: 0, total: 0 }; });

    EXAM_DATA.forEach(function (q) {
      perTopic[q.topic].total++;
      var answered = isAnswered(session, q.id);
      var ok = answered && isCorrect(session, q.id);
      if (ok) {
        correctCount++;
        perTopic[q.topic].correct++;
      } else if (answered) {
        wrongIds.push(q.id);
      } else {
        unansweredIds.push(q.id);
      }
    });

    var perTopicList = TOPICS.map(function (t) {
      var s = perTopic[t];
      return {
        topic: t,
        correct: s.correct,
        total: s.total,
        pct: s.total ? Math.round((s.correct / s.total) * 100) : 0
      };
    });

    return {
      correctCount: correctCount,
      total: total,
      pct: total ? Math.round((correctCount / total) * 100) : 0,
      perTopic: perTopicList,
      wrongIds: wrongIds,
      unansweredIds: unansweredIds
    };
  }

  // ---------- rendering helpers ----------

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function nl2p(text) {
    return text.split(/\n{2,}/).map(function (para) {
      return '<p>' + esc(para).replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }

  function renderImages(images) {
    if (!images || !images.length) return '';
    return '<div class="qimages">' + images.map(function (src) {
      return '<img src="' + esc(src) + '" alt="Exhibit" loading="lazy">';
    }).join('') + '</div>';
  }

  function getMatchOptionOrder(q) {
    if (!matchOptionOrderCache[q.id]) {
      var terms = q.pairs.map(function (p) { return p.term; });
      for (var i = terms.length - 1; i > 0; i--) {
        var j = Math.floor(Math.random() * (i + 1));
        var tmp = terms[i]; terms[i] = terms[j]; terms[j] = tmp;
      }
      matchOptionOrderCache[q.id] = terms;
    }
    return matchOptionOrderCache[q.id];
  }

  // ---------- screens ----------

  function renderStart() {
    var session = loadSession();
    var resumeHtml = '';
    if (session && !session.finished && remainingSeconds(session) > 0) {
      var answeredCount = session.order.filter(function (id) { return isAnswered(session, id); }).length;
      resumeHtml =
        '<div class="card resume">' +
        '<p><strong>Es gibt eine laufende Prüfung.</strong></p>' +
        '<p>' + answeredCount + ' von ' + TOTAL_QUESTIONS + ' Fragen beantwortet, noch ' +
        fmtTime(remainingSeconds(session)) + ' übrig.</p>' +
        '<button class="btn primary" id="btnResume">Fortsetzen</button> ' +
        '<button class="btn ghost" id="btnDiscard">Verwerfen &amp; neu starten</button>' +
        '</div>';
    } else if (session && session.finished) {
      resumeHtml =
        '<div class="card resume">' +
        '<p><strong>Es gibt eine abgeschlossene Prüfung.</strong></p>' +
        '<button class="btn primary" id="btnShowResults">Letzte Auswertung ansehen</button> ' +
        '<button class="btn ghost" id="btnDiscard">Neue Prüfung starten</button>' +
        '</div>';
    }

    root.innerHTML =
      '<div class="screen start">' +
      '<h1>CCNA Prüfungssimulation</h1>' +
      '<div class="card">' +
      '<ul class="facts">' +
      '<li><strong>' + TOTAL_QUESTIONS + '</strong> Fragen aus <strong>' + TOPICS.length + '</strong> Themenbereichen</li>' +
      '<li><strong>' + DURATION_MIN + ' Minuten</strong> Zeit</li>' +
      '<li>Keine Rückmeldung während der Prüfung &mdash; Auswertung erst am Ende</li>' +
      '<li>Fortschritt wird automatisch lokal gespeichert (dieser Browser)</li>' +
      '</ul>' +
      (session && !session.finished && remainingSeconds(session) > 0 ? '' :
        '<button class="btn primary" id="btnStart">Prüfung starten</button>') +
      '</div>' +
      resumeHtml +
      '</div>';

    var b;
    if ((b = document.getElementById('btnStart'))) b.onclick = function () { goExam(newSession()); };
    if ((b = document.getElementById('btnResume'))) b.onclick = function () { goExam(loadSession()); };
    if ((b = document.getElementById('btnShowResults'))) b.onclick = function () { goResults(loadSession()); };
    if ((b = document.getElementById('btnDiscard'))) b.onclick = function () {
      if (confirm('Aktuellen Fortschritt wirklich verwerfen und neu starten?')) {
        clearSession();
        goExam(newSession());
      }
    };
  }

  function renderExam(session) {
    var pos = session.currentPos;
    var id = session.order[pos];
    var q = BY_ID[id];
    var flagged = session.flagged.indexOf(id) !== -1;

    var navGrid = session.order.map(function (qid, i) {
      var cls = 'navbtn';
      if (isAnswered(session, qid)) cls += ' answered';
      if (session.flagged.indexOf(qid) !== -1) cls += ' flagged';
      if (i === pos) cls += ' current';
      return '<button class="' + cls + '" data-pos="' + i + '">' + (i + 1) + '</button>';
    }).join('');

    var answerHtml = '';
    var a = session.answers[id];

    if (q.type === 'match') {
      var order = getMatchOptionOrder(q);
      answerHtml = '<div class="match">' + q.pairs.map(function (p) {
        var sel = (a && a[p.n]) || '';
        return '<div class="matchrow">' +
          '<div class="matchdesc">' + esc(p.description) + '</div>' +
          '<select data-n="' + p.n + '">' +
          '<option value="">— wählen —</option>' +
          order.map(function (term) {
            return '<option value="' + esc(term) + '"' + (term === sel ? ' selected' : '') + '>' + esc(term) + '</option>';
          }).join('') +
          '</select>' +
          '</div>';
      }).join('') + '</div>';
    } else {
      var inputType = q.type === 'multi' ? 'checkbox' : 'radio';
      var selSet = a || [];
      answerHtml = '<div class="options">' + q.options.map(function (o) {
        var checked = selSet.indexOf(o.letter) !== -1 ? ' checked' : '';
        return '<label class="option">' +
          '<input type="' + inputType + '" name="opt" value="' + o.letter + '"' + checked + '>' +
          '<span class="optiontext">' + esc(o.letter) + '. ' + esc(o.text).replace(/\n/g, '<br>') + '</span>' +
          '</label>';
      }).join('') + '</div>';
    }

    var typeHint = q.type === 'multi' ? '<p class="hint">Mehrere Antworten möglich.</p>' :
      q.type === 'match' ? '<p class="hint">Jedem Begriff die passende Beschreibung zuordnen.</p>' : '';

    root.innerHTML =
      '<div class="screen exam">' +
      '<div class="examheader">' +
      '<div class="progress">Frage ' + (pos + 1) + ' / ' + TOTAL_QUESTIONS + '</div>' +
      '<div class="timer" id="timer"></div>' +
      '<button class="btn small ghost" id="btnNav">Übersicht</button>' +
      '<button class="btn small primary" id="btnFinish">Prüfung abschließen</button>' +
      '</div>' +
      '<div class="examBody">' +
      '<nav class="navpanel" id="navpanel">' + navGrid + '</nav>' +
      '<div class="qcard">' +
      '<div class="qtopic">' + esc(q.topic) + '</div>' +
      nl2p(q.text) +
      renderImages(q.images) +
      typeHint +
      answerHtml +
      '<label class="flag"><input type="checkbox" id="flagbox"' + (flagged ? ' checked' : '') + '> Zur Überprüfung markieren</label>' +
      '<div class="examnav">' +
      '<button class="btn ghost" id="btnPrev"' + (pos === 0 ? ' disabled' : '') + '>&larr; Zurück</button>' +
      '<button class="btn ghost" id="btnNext"' + (pos === TOTAL_QUESTIONS - 1 ? ' disabled' : '') + '>Weiter &rarr;</button>' +
      '</div>' +
      '</div>' +
      '</div>' +
      '</div>';

    // wire answer inputs
    if (q.type === 'match') {
      Array.prototype.forEach.call(root.querySelectorAll('.match select'), function (sel) {
        sel.onchange = function () {
          var n = sel.getAttribute('data-n');
          session.answers[id] = session.answers[id] || {};
          if (sel.value) session.answers[id][n] = sel.value;
          else delete session.answers[id][n];
          saveSession(session);
          refreshNavButton(id);
        };
      });
    } else {
      Array.prototype.forEach.call(root.querySelectorAll('.options input'), function (inp) {
        inp.onchange = function () {
          var checked = Array.prototype.filter.call(
            root.querySelectorAll('.options input'), function (i2) { return i2.checked; }
          ).map(function (i2) { return i2.value; });
          session.answers[id] = checked;
          saveSession(session);
          refreshNavButton(id);
        };
      });
    }

    document.getElementById('flagbox').onchange = function (e) {
      var idx = session.flagged.indexOf(id);
      if (e.target.checked && idx === -1) session.flagged.push(id);
      if (!e.target.checked && idx !== -1) session.flagged.splice(idx, 1);
      saveSession(session);
      refreshNavButton(id);
    };

    document.getElementById('btnPrev').onclick = function () {
      session.currentPos = Math.max(0, pos - 1);
      saveSession(session);
      renderExam(session);
    };
    document.getElementById('btnNext').onclick = function () {
      session.currentPos = Math.min(TOTAL_QUESTIONS - 1, pos + 1);
      saveSession(session);
      renderExam(session);
    };
    document.getElementById('btnNav').onclick = function () {
      document.getElementById('navpanel').classList.toggle('open');
    };
    document.getElementById('btnFinish').onclick = function () { confirmSubmit(session); };

    Array.prototype.forEach.call(root.querySelectorAll('.navbtn'), function (btn) {
      btn.onclick = function () {
        session.currentPos = parseInt(btn.getAttribute('data-pos'), 10);
        saveSession(session);
        renderExam(session);
      };
    });

    function refreshNavButton(qid) {
      var i = session.order.indexOf(qid);
      var btn = root.querySelector('.navbtn[data-pos="' + i + '"]');
      if (!btn) return;
      btn.className = 'navbtn' +
        (isAnswered(session, qid) ? ' answered' : '') +
        (session.flagged.indexOf(qid) !== -1 ? ' flagged' : '') +
        (i === pos ? ' current' : '');
    }

    startTimer(session);
  }

  function startTimer(session) {
    stopTimer();
    updateTimer(session);
    timerHandle = setInterval(function () {
      if (session.finished) { stopTimer(); return; }
      var remaining = remainingSeconds(session);
      updateTimer(session, remaining);
      if (remaining <= 0) {
        stopTimer();
        finishExam(session);
      }
    }, 1000);
  }

  function stopTimer() {
    if (timerHandle) { clearInterval(timerHandle); timerHandle = null; }
  }

  function updateTimer(session, remaining) {
    var el = document.getElementById('timer');
    if (!el) return;
    if (remaining === undefined) remaining = remainingSeconds(session);
    el.textContent = fmtTime(remaining);
    el.className = 'timer' + (remaining <= 600 ? ' low' : '');
  }

  function confirmSubmit(session) {
    var unanswered = session.order.filter(function (id) { return !isAnswered(session, id); }).length;
    var msg = unanswered > 0
      ? unanswered + ' von ' + TOTAL_QUESTIONS + ' Fragen sind noch unbeantwortet. Prüfung trotzdem abschließen?'
      : 'Prüfung jetzt abschließen und Auswertung anzeigen?';
    if (confirm(msg)) finishExam(session);
  }

  function finishExam(session) {
    session.finished = true;
    session.submittedAt = Date.now();
    saveSession(session);
    stopTimer();
    goResults(session);
  }

  function renderResults(session) {
    var r = computeResults(session);

    var topicRows = r.perTopic.map(function (t) {
      return '<tr><td>' + esc(t.topic) + '</td><td>' + t.correct + ' / ' + t.total + '</td>' +
        '<td><div class="bar"><div class="barfill" style="width:' + t.pct + '%"></div></div> ' + t.pct + '%</td></tr>';
    }).join('');

    function reviewList(ids, label, cls) {
      if (!ids.length) return '';
      return '<div class="reviewgroup"><h3>' + label + ' (' + ids.length + ')</h3><ul class="reviewlist">' +
        ids.map(function (id) {
          var q = BY_ID[id];
          return '<li><button class="reviewlink ' + cls + '" data-id="' + id + '">' +
            esc(q.topic) + ': ' + esc(q.text.slice(0, 70)) + (q.text.length > 70 ? '…' : '') +
            '</button></li>';
        }).join('') + '</ul></div>';
    }

    root.innerHTML =
      '<div class="screen results">' +
      '<h1>Auswertung</h1>' +
      '<div class="card scorecard">' +
      '<div class="scorebig">' + r.correctCount + ' / ' + r.total + '</div>' +
      '<div class="scorepct">' + r.pct + '% richtig</div>' +
      '</div>' +
      '<div class="card">' +
      '<h2>Nach Themenbereich</h2>' +
      '<table class="topictable"><tbody>' + topicRows + '</tbody></table>' +
      '</div>' +
      '<div class="card">' +
      reviewList(r.wrongIds, 'Falsch beantwortet', 'wrong') +
      reviewList(r.unansweredIds, 'Unbeantwortet', 'unanswered') +
      (r.wrongIds.length + r.unansweredIds.length === 0 ? '<p>Alle Fragen richtig beantwortet.</p>' : '') +
      '</div>' +
      '<button class="btn primary" id="btnRestart">Neue Prüfung starten</button>' +
      '</div>';

    Array.prototype.forEach.call(root.querySelectorAll('.reviewlink'), function (btn) {
      btn.onclick = function () {
        goReview(parseInt(btn.getAttribute('data-id'), 10), session, r);
      };
    });
    document.getElementById('btnRestart').onclick = function () {
      if (confirm('Neue Prüfung starten? Die aktuelle Auswertung geht dabei verloren.')) {
        clearSession();
        goExam(newSession());
      }
    };
  }

  function renderReview(id, session, results) {
    var q = BY_ID[id];
    var a = session.answers[id];
    var reviewIds = results.wrongIds.concat(results.unansweredIds);
    var idx = reviewIds.indexOf(id);

    var answerHtml = '';
    if (q.type === 'match') {
      answerHtml = '<table class="reviewtable"><thead><tr><th>Beschreibung</th><th>Deine Antwort</th><th>Richtig</th></tr></thead><tbody>' +
        q.pairs.map(function (p) {
          var yours = (a && a[p.n]) || '(leer)';
          var ok = a && a[p.n] === p.term;
          return '<tr><td>' + esc(p.description) + '</td>' +
            '<td class="' + (ok ? 'ok' : 'bad') + '">' + esc(yours) + '</td>' +
            '<td class="ok">' + esc(p.term) + '</td></tr>';
        }).join('') + '</tbody></table>';
    } else {
      var sel = a || [];
      answerHtml = '<div class="options readonly">' + q.options.map(function (o) {
        var wasSelected = sel.indexOf(o.letter) !== -1;
        var isRight = q.correct.indexOf(o.letter) !== -1;
        var cls = isRight ? 'ok' : (wasSelected ? 'bad' : '');
        var mark = isRight ? ' ✓' : (wasSelected ? ' ✗' : '');
        return '<div class="option ' + cls + '">' + esc(o.letter) + '. ' + esc(o.text).replace(/\n/g, '<br>') + mark + '</div>';
      }).join('') + '</div>';
    }

    root.innerHTML =
      '<div class="screen review">' +
      '<button class="btn ghost" id="btnBack">&larr; Zurück zur Auswertung</button>' +
      '<div class="qcard">' +
      '<div class="qtopic">' + esc(q.topic) + '</div>' +
      nl2p(q.text) +
      renderImages(q.images) +
      answerHtml +
      '</div>' +
      '<div class="examnav">' +
      '<button class="btn ghost" id="btnRevPrev"' + (idx <= 0 ? ' disabled' : '') + '>&larr; Vorherige</button>' +
      '<span>' + (idx + 1) + ' / ' + reviewIds.length + '</span>' +
      '<button class="btn ghost" id="btnRevNext"' + (idx >= reviewIds.length - 1 ? ' disabled' : '') + '>Nächste &rarr;</button>' +
      '</div>' +
      '</div>';

    document.getElementById('btnBack').onclick = function () { goResults(session); };
    var pb = document.getElementById('btnRevPrev');
    if (pb) pb.onclick = function () { goReview(reviewIds[idx - 1], session, results); };
    var nb = document.getElementById('btnRevNext');
    if (nb) nb.onclick = function () { goReview(reviewIds[idx + 1], session, results); };
  }

  // ---------- navigation ----------

  function goExam(session) { stopTimer(); renderExam(session); }
  function goResults(session) { stopTimer(); renderResults(session); }
  function goReview(id, session, results) { stopTimer(); renderReview(id, session, results); }

  renderStart();
})();
