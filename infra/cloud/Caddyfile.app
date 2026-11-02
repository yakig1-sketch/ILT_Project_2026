# Caddy on an app VM: one site per gateway cell, with automatic HTTPS (Let's Encrypt).
# https://<cell host>/tablet/   tablet kiosk      https://<cell host>/cockpit/   evaluator cockpit
# /api/* and /ws/* go to that cell's gateway.
{
	email {$ACME_EMAIL}
}

(cell) {
	encode zstd gzip
	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options nosniff
		Referrer-Policy no-referrer
	}
	@assets path /tablet/assets/* /cockpit/assets/*
	header @assets Cache-Control "public, max-age=31536000, immutable"

	@gateway path /api/* /ws/*
	handle @gateway {
		reverse_proxy {args[0]}:8080
	}
	redir /tablet /tablet/
	redir /cockpit /cockpit/
	handle_path /tablet/* {
		root * /srv/tablet
		try_files {path} /index.html
		file_server
	}
	handle_path /cockpit/* {
		root * /srv/cockpit
		try_files {path} /index.html
		file_server
	}
	handle {
		redir * /cockpit/
	}
}

{$CELL_1_HOST} {
	import cell gateway-1
}
{$CELL_2_HOST} {
	import cell gateway-2
}
{$CELL_3_HOST} {
	import cell gateway-3
}
{$CELL_4_HOST} {
	import cell gateway-4
}
