CREATE TABLE "out_of_coverage_signups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"suburb" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
