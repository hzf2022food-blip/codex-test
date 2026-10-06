function initializeButton() {
  const button = document.getElementById('click-button');
  const message = document.getElementById('message');

  button.addEventListener('click', () => {
    message.textContent = 'Codex is working!';
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeButton, { once: true });
} else {
  initializeButton();
}
