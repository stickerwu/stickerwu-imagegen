// Only redacted profile summaries are read back from the loopback server.
export function initApiSettings({ api, changed, status, isBusy }) {
  const $ = id => document.getElementById(id), dialog = $('api-settings'), form = $('api-form');
  let config, saving = false;
  const message = (text, error = false) => {
    $('api-message').textContent = text;
    $('api-message').classList.toggle('invalid', error);
  };
  function populate(name) {
    const entry = config?.profiles.find(profile => profile.name === name);
    $('api-name').value = entry?.name || '';
    $('api-url').value = entry?.baseUrl || '';
    $('api-key').value = '';
    $('api-key').placeholder = entry?.hasKey ? '已保存；留空保持（更换地址会清除旧密钥）' : '输入该地址对应的 API Key';
    $('api-switch').disabled = !entry || saving;
  }
  function render(value) {
    config = value;
    $('api-profiles').replaceChildren();
    for (const entry of value.profiles) {
      const option = document.createElement('option'); option.value = entry.name;
      option.textContent = `${entry.name}${entry.name === value.activeProfile ? ' · 默认' : ''}`;
      $('api-profiles').append(option);
    }
    const add = document.createElement('option'); add.value = ''; add.textContent = '＋ 新建连接';
    $('api-profiles').append(add);
    $('api-profiles').value = value.selectedProfile || '';
    populate($('api-profiles').value);
    $('api-current').textContent = `当前：${value.selectedProfile || '临时连接'} · ${value.baseUrl}${value.source === 'profile' ? '' : '（本次启动覆盖）'}${value.hasKey ? '' : ' · 尚未配置密钥'}`;
    for (const field of form.elements) field.disabled = !value.editable;
    $('api-switch').disabled = !value.editable || !$('api-profiles').value;
    message(value.editable ? 'API Key 仅保存在本机配置。保存或切换不会发起生图。' : '此会话没有启用持久化 API 设置。');
  }
  $('api-settings-open').addEventListener('click', async () => {
    if (isBusy()) return;
    $('menu').hidden = true; $('menu-toggle').setAttribute('aria-expanded', 'false');
    try { render(await api('api/config')); dialog.showModal(); $('api-profiles').focus(); }
    catch (error) { status(error.message, 'error'); }
  });
  function close() {
    if (saving) return;
    $('api-key').value = ''; dialog.close(); $('api-settings-open').focus();
  }
  $('api-close').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  $('api-profiles').addEventListener('change', () => { populate($('api-profiles').value); message('切换前点击“切换连接”；编辑后点击“保存并使用”。'); });
  async function perform(action) {
    if (saving || isBusy()) return;
    const payload = action === 'switch' ? { action, name: $('api-profiles').value } : {
      action, name: $('api-name').value.trim(), baseUrl: $('api-url').value.trim(),
      ...($('api-key').value ? { apiKey: $('api-key').value.trim() } : {}),
    };
    if (action === 'save' && !form.reportValidity()) return;
    saving = true; for (const field of form.elements) field.disabled = true;
    try {
      render(await api('api/config', payload));
      $('api-key').value = '';
      await changed(); message('已保存并使用此连接。下一次点击生图时生效。');
    } catch (error) { message(error.message, true); }
    finally {
      saving = false; for (const field of form.elements) field.disabled = !config?.editable;
      $('api-switch').disabled = !config?.editable || !$('api-profiles').value;
    }
  }
  form.addEventListener('submit', event => { event.preventDefault(); perform('save'); });
  $('api-switch').addEventListener('click', () => perform('switch'));
}
