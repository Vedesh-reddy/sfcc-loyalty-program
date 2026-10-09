'use strict';

// Applying or removing points changes every total, so the checkout reloads with the new prices.
document.addEventListener('submit', function (event) {
    var form = event.target.closest('.loyalty-points-form');
    if (!form) return;
    event.preventDefault();
    var message = form.closest('[data-loyalty-panel]').querySelector('.loyalty-points-message');
    fetch(form.action, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'XMLHttpRequest' },
        body: new URLSearchParams(new FormData(form)).toString()
    }).then(function (response) {
        return response.json();
    }).then(function (data) {
        if (data.success) {
            window.location.reload();
        } else {
            message.textContent = data.errorMessage || '';
        }
    }).catch(function () {
        window.location.reload();
    });
});
