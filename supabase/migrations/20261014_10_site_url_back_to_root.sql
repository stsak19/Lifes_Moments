-- The site page is now index.html, so the guest emails link to the site root.
update public.email_settings
   set site_url = 'https://stsak19.github.io/lifes_moments/'
 where id = 1 and site_url = 'https://stsak19.github.io/lifes_moments/redesign.html';
