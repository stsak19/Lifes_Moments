-- Guest emails: what the owners edit in admin Settings (details + wording) and a log of what was sent.
create table public.email_settings (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default true,
  from_name text not null default 'Life''s Moments' check (char_length(from_name) <= 80),
  from_email text not null default 'onboarding@resend.dev' check (from_email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  reply_to text check (reply_to is null or reply_to = '' or reply_to ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  owner_copy_email text check (owner_copy_email is null or owner_copy_email = '' or owner_copy_email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  site_url text not null default 'https://stsak19.github.io/lifes_moments/' check (site_url ~ '^https://'),
  checkin_time text not null default '15:00' check (char_length(checkin_time) <= 20),
  checkout_time text not null default '11:00' check (char_length(checkout_time) <= 20),
  address text not null default '' check (char_length(address) <= 300),
  maps_url text not null default '' check (maps_url = '' or maps_url ~ '^https://'),
  phone text not null default '' check (char_length(phone) <= 60),
  arrival_el text not null default '' check (char_length(arrival_el) <= 2000),
  arrival_en text not null default '' check (char_length(arrival_en) <= 2000),
  extra_el text not null default '' check (char_length(extra_el) <= 2000),
  extra_en text not null default '' check (char_length(extra_en) <= 2000)
);
insert into public.email_settings (id) values (1);

create table public.email_templates (
  kind text not null check (kind in ('received','confirmed','rejected','expired')),
  lang text not null check (lang in ('el','en')),
  subject text not null check (char_length(subject) between 1 and 200),
  body text not null check (char_length(body) between 1 and 8000),
  primary key (kind, lang)
);

create table public.email_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  request_id uuid,
  kind text not null,
  to_email text not null,
  status text not null check (status in ('sent','failed','skipped')),
  error text,
  provider_id text
);
create unique index email_log_one_sent on public.email_log (request_id, kind) where status = 'sent';
create index email_log_recent on public.email_log (created_at desc);

alter table public.email_settings enable row level security;
alter table public.email_templates enable row level security;
alter table public.email_log enable row level security;

create policy "owners read email settings" on public.email_settings for select to authenticated using (public.is_owner());
create policy "owners change email settings" on public.email_settings for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "owners read email templates" on public.email_templates for select to authenticated using (public.is_owner());
create policy "owners change email templates" on public.email_templates for update to authenticated using (public.is_owner()) with check (public.is_owner());
create policy "owners read email log" on public.email_log for select to authenticated using (public.is_owner());

insert into public.email_templates (kind, lang, subject, body) values
('received','el','Λάβαμε το αίτημά σου – Life''s Moments',
$t$Γεια σου {{name}},

Λάβαμε το αίτημα κράτησής σου και θα σου απαντήσουμε μέσα σε 24 ώρες.

Στοιχεία αιτήματος
• Κατάλυμα: {{unit_type}}
• Άφιξη: {{check_in}}
• Αναχώρηση: {{check_out}}
• Διανυκτερεύσεις: {{nights}}
• Άτομα: {{guests}}

Η κράτηση δεν έχει επιβεβαιωθεί ακόμη. Θα λάβεις νέο email μόλις την εξετάσουμε.

Αν χρειαστείς κάτι στο μεταξύ, τηλέφωνο επικοινωνίας: {{phone}}

Life's Moments$t$),
('received','en','We received your request – Life''s Moments',
$t$Hello {{name}},

We have received your booking request and will reply within 24 hours.

Request details
• Accommodation: {{unit_type}}
• Check-in: {{check_in}}
• Check-out: {{check_out}}
• Nights: {{nights}}
• Guests: {{guests}}

Your booking is not confirmed yet. You will get another email as soon as we have reviewed it.

If you need anything in the meantime, call us: {{phone}}

Life's Moments$t$),
('confirmed','el','Η κράτησή σου επιβεβαιώθηκε – Life''s Moments',
$t$Γεια σου {{name}},

Με χαρά επιβεβαιώνουμε την κράτησή σου!

Στοιχεία κράτησης
• Κατάλυμα: {{unit}}
• Άφιξη (check-in): {{check_in}}, από τις {{checkin_time}}
• Αναχώρηση (check-out): {{check_out}}, έως τις {{checkout_time}}
• Διανυκτερεύσεις: {{nights}}
• Άτομα: {{guests}}

Πώς θα φτάσεις
Διεύθυνση: {{address}}
Χάρτης: {{maps_url}}
{{arrival}}

{{extra}}

Για οτιδήποτε χρειαστείς, τηλέφωνο επικοινωνίας: {{phone}}

Σε περιμένουμε!
Life's Moments$t$),
('confirmed','en','Your booking is confirmed – Life''s Moments',
$t$Hello {{name}},

We are happy to confirm your booking!

Booking details
• Accommodation: {{unit}}
• Check-in: {{check_in}}, from {{checkin_time}}
• Check-out: {{check_out}}, by {{checkout_time}}
• Nights: {{nights}}
• Guests: {{guests}}

How to get here
Address: {{address}}
Map: {{maps_url}}
{{arrival}}

{{extra}}

If you need anything, call us: {{phone}}

We look forward to welcoming you!
Life's Moments$t$),
('rejected','el','Σχετικά με το αίτημά σου – Life''s Moments',
$t$Γεια σου {{name}},

Σε ευχαριστούμε για το ενδιαφέρον σου. Δυστυχώς δεν μπορούμε να δεχτούμε το αίτημά σου για {{check_in}} – {{check_out}}.

Μπορείς να δοκιμάσεις άλλες ημερομηνίες εδώ: {{site_url}}

Αν θέλεις να το συζητήσουμε, τηλέφωνο επικοινωνίας: {{phone}}

Life's Moments$t$),
('rejected','en','About your request – Life''s Moments',
$t$Hello {{name}},

Thank you for your interest. Unfortunately we cannot accept your request for {{check_in}} – {{check_out}}.

You are welcome to try other dates here: {{site_url}}

If you would like to talk it over, call us: {{phone}}

Life's Moments$t$),
('expired','el','Το αίτημά σου έληξε – Life''s Moments',
$t$Γεια σου {{name}},

Λυπούμαστε, δεν προλάβαμε να επιβεβαιώσουμε το αίτημά σου για {{check_in}} – {{check_out}} και έληξε.

Μπορείς να στείλεις νέο αίτημα εδώ: {{site_url}}

Ή να επικοινωνήσεις απευθείας μαζί μας: {{phone}}

Life's Moments$t$),
('expired','en','Your request has expired – Life''s Moments',
$t$Hello {{name}},

We are sorry, we could not confirm your request for {{check_in}} – {{check_out}} in time, so it has expired.

You can send a new request here: {{site_url}}

Or contact us directly: {{phone}}

Life's Moments$t$);
