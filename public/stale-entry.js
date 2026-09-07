// Served only when cached HTML references a removed entry bundle. React has
// not started, so replacing this failed navigation cannot discard form input.
(function () {
  var url = new URL(window.location.href);
  var now = Date.now();
  var previousAttempt = Number(url.searchParams.get('_app_update'));
  if (previousAttempt > 0 && now - previousAttempt >= 0 && now - previousAttempt < 60000) {
    // A proxy may still be serving stale HTML. Avoid an automatic reload loop.
    function showRecovery() {
      var message = document.createElement('p');
      message.textContent = 'Support kunde inte ladda den nya versionen. Försök ladda om sidan.';
      var button = document.createElement('button');
      button.textContent = 'Ladda om Support';
      button.onclick = function () {
        url.searchParams.set('_app_update', String(Date.now()));
        window.location.replace(url.href);
      };
      document.body.append(message, button);
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', showRecovery, { once: true });
    } else {
      showRecovery();
    }
    return;
  }
  url.searchParams.set('_app_update', String(now));
  window.location.replace(url.href);
}());
