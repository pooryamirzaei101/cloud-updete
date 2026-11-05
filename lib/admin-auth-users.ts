import {sql} from "drizzle-orm";
import {getDb} from "@/db";

// Supabase Auth owns the canonical account list. Mirror accounts that have not
// opened an application page yet so the administrator can still find them.
// Pending records created in the Users studio keep priority until first sign-in.
export async function syncAuthUsersForAdmin(){
  const now=Date.now();
  await getDb().execute(sql`
    INSERT INTO learner_profiles (
      user_id,is_pending,pending_email,email,display_name,country,level,purpose,
      newsletter_consent,newsletter_consent_at,completed_at,created_at,updated_at,last_seen_at
    )
    SELECT
      auth_user.id::text,0,NULL,LOWER(auth_user.email),
      COALESCE(
        NULLIF(auth_user.raw_user_meta_data->>'full_name',''),
        NULLIF(auth_user.raw_user_meta_data->>'name',''),
        NULLIF(SPLIT_PART(auth_user.email,'@',1),''),
        'Learner'
      ),
      '','','',0,NULL,NULL,
      (EXTRACT(EPOCH FROM auth_user.created_at)*1000)::bigint,
      ${now},0
    FROM auth.users AS auth_user
    WHERE auth_user.email IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM learner_profiles AS pending
        WHERE pending.is_pending=1
          AND pending.pending_email=LOWER(auth_user.email)
      )
    ON CONFLICT (user_id) DO UPDATE SET
      email=EXCLUDED.email,
      display_name=CASE
        WHEN learner_profiles.display_name='' THEN EXCLUDED.display_name
        ELSE learner_profiles.display_name
      END,
      updated_at=GREATEST(learner_profiles.updated_at,EXCLUDED.updated_at)
    WHERE learner_profiles.email IS DISTINCT FROM EXCLUDED.email
       OR learner_profiles.display_name=''
  `);
}
