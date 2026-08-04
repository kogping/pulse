CREATE TABLE "auth_sessions" (
	"session_token" text PRIMARY KEY NOT NULL,
	"curator_id" uuid NOT NULL,
	"expires" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_verification_tokens" (
	"identifier" text NOT NULL,
	"token" text NOT NULL,
	"expires" timestamp with time zone NOT NULL,
	CONSTRAINT "auth_verification_tokens_identifier_token_pk" PRIMARY KEY("identifier","token")
);
--> statement-breakpoint
ALTER TABLE "curators" ADD COLUMN "active" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "curators" ADD COLUMN "precinct_id" text;--> statement-breakpoint
ALTER TABLE "curators" ADD COLUMN "tier" text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_curator_id_curators_id_fk" FOREIGN KEY ("curator_id") REFERENCES "public"."curators"("id") ON DELETE cascade ON UPDATE no action;