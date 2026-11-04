/** Navigate by POSTing a hidden form, as the SAML HTTP-POST binding has the
 *  browser deliver its messages. Fields that are null are left out. */
export function postForm(url: string, fields: Record<string, string | null>) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = url;
  form.style.display = "none";
  for (const [name, value] of Object.entries(fields)) {
    if (value === null) continue;
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  form.submit();
}
