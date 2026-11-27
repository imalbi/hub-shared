export const settings = { baseUrl: 'https://water.example.org/jobs', company: 'Example Water' };
export const listing = (closed = false) =>
  `<html><body><div class="page-text"><table><tbody><tr><td><p>Tecnico manutentore</p><p>Sede di lavoro: Exampleville</p><p>Profilo elettrico su diploma</p><p>Profilo ingegnere su laurea</p></td><td>30/12/2026</td><td><a href="/notice.pdf">AVVISO DI SELEZIONE</a><a href="https://login.example.org/">ACCEDI</a></td><td>${closed ? 'CHIUSA' : 'APERTA'}</td></tr></tbody></table></div></body></html>`;
