(function () {
  function initDatePickers() {
    document.querySelectorAll('input.datepicker').forEach(function (input) {
      if (input.flatpickrInstance) return;
      input.flatpickrInstance = flatpickr(input, {
        enableTime: false,
        dateFormat: 'd/m/Y',
        defaultDate: input.value || null,
        locale: 'pt',
        disableMobile: true
      });
      if (!input.getAttribute('placeholder')) input.setAttribute('placeholder', 'dd/mm/aaaa');
    });
  }

  function prepareDateInputsOnSubmit() {
    document.querySelectorAll('form').forEach(function (form) {
      if (form.dataset.datePrepared) return;
      form.dataset.datePrepared = '1';
      form.addEventListener('submit', function () {
        form.querySelectorAll('input.datepicker').forEach(function (input) {
          var v = (input.value || '').trim();
          var m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
          if (m) {
            input.value = m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0');
          }
        });
      });
    });
  }

  function run() {
    initDatePickers();
    prepareDateInputsOnSubmit();
  }

  if (document.readyState !== 'loading') {
    run();
  } else {
    document.addEventListener('DOMContentLoaded', run);
  }
})();
