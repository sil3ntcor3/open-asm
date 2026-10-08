package worker

import (
	"strings"
	"testing"
)

// Real `nmap -sV -oG -` output captured against frazerlanier.com (72.52.228.35),
// covering a web/non-web mix plus a web service on a non-standard port. The web
// services (http, ssl/http, http on :9000) must be classified as web with the
// correct scheme; the mail/ftp services must not.
const nmapGreppableSample = "# Nmap 7.99 scan initiated\n" +
	"Host: 72.52.228.35 ()\tPorts: " +
	"21/open/tcp//ftp//Pure-FTPd/, " +
	"80/open/tcp//http//Apache httpd/, " +
	"143/open/tcp//imap//Dovecot imapd/, " +
	"443/open/tcp//ssl|http//Apache httpd/, " +
	"465/open/tcp//ssl|smtp//Exim smtpd 4.99.4/, " +
	"993/open/tcp//ssl|imap//Dovecot imapd/, " +
	"995/open/tcp//ssl|pop3//Dovecot pop3d/, " +
	"9000/open/tcp//http//nginx/, " +
	"22/filtered/tcp//ssh///\tIgnored State: closed (996)\n"

func serviceByPort(services []NmapService, port int) (NmapService, bool) {
	for _, s := range services {
		if s.Port == port {
			return s, true
		}
	}
	return NmapService{}, false
}

func TestParseNmapServicesClassifiesWebAndScheme(t *testing.T) {
	services := parseNmapServices(nmapGreppableSample)

	cases := []struct {
		port    int
		isWeb   bool
		scheme  string
		service string
	}{
		{80, true, "http", "http"},
		{443, true, "https", "ssl/http"}, // ssl|http -> ssl/http -> https
		{9000, true, "http", "http"},     // web on a non-standard port, still web
		{21, false, "", "ftp"},
		{143, false, "", "imap"},
		{465, false, "", "ssl/smtp"},
		{993, false, "", "ssl/imap"},
		{995, false, "", "ssl/pop3"},
	}

	for _, tc := range cases {
		svc, ok := serviceByPort(services, tc.port)
		if !ok {
			t.Fatalf("port %d missing from parsed services", tc.port)
		}
		if svc.IsWeb != tc.isWeb || svc.Scheme != tc.scheme || svc.Service != tc.service {
			t.Errorf("port %d: got {service=%q web=%v scheme=%q}, want {service=%q web=%v scheme=%q}",
				tc.port, svc.Service, svc.IsWeb, svc.Scheme, tc.service, tc.isWeb, tc.scheme)
		}
	}
}

func TestParseNmapServicesDropsFilteredNonWebPorts(t *testing.T) {
	// A filtered non-web port carries only nmap's port-number guess (no banner);
	// recording it as e.g. "ssh" would wrongly mark it non-web and let the gate
	// exclude a possibly-web odd port. Filtered non-web ports are therefore left
	// unclassified (dropped here) so the best-effort screenshot gate handles them.
	services := parseNmapServices(nmapGreppableSample)
	if _, ok := serviceByPort(services, 22); ok {
		t.Errorf("filtered non-web port 22 must not be recorded as a service")
	}
	if len(services) != 8 {
		t.Errorf("expected 8 open services (filtered ssh dropped), got %d", len(services))
	}
}

func TestParseNmapServicesRecoversFilteredWebService(t *testing.T) {
	// Exact `nmap -sV -oG -` output captured against pentest-ground.com:80 while
	// the target's IPS was filtering the worker during the naabu storm. nmap can
	// no longer grab the banner (product empty) but still port-labels it http, so
	// we must classify it as a web service — otherwise scheme stays NULL, the
	// screenshot step is gated out, and the chain never reaches nuclei.
	sample := "Host: 178.79.134.182 ()\tPorts: 80/filtered/tcp//http///\n"
	services := parseNmapServices(sample)
	svc, ok := serviceByPort(services, 80)
	if !ok {
		t.Fatal("filtered web port 80 must be classified, not dropped")
	}
	if !svc.IsWeb || svc.Scheme != "http" {
		t.Errorf("port 80: got {web=%v scheme=%q}, want web http", svc.IsWeb, svc.Scheme)
	}
}

func TestParseNmapServicesRecoversFilteredHttpsService(t *testing.T) {
	// A filtered TLS web service still carries the "ssl/http" (escaped "ssl|http")
	// label and must be recovered as https so it is screenshotted.
	sample := "Host: 178.79.134.182 ()\tPorts: 443/filtered/tcp//ssl|http///\n"
	services := parseNmapServices(sample)
	svc, ok := serviceByPort(services, 443)
	if !ok {
		t.Fatal("filtered https port 443 must be classified, not dropped")
	}
	if !svc.IsWeb || svc.Scheme != "https" {
		t.Errorf("port 443: got {web=%v scheme=%q}, want web https", svc.IsWeb, svc.Scheme)
	}
}

func TestParseNmapServicesExcludesClosedPorts(t *testing.T) {
	// A definitively closed port is not a live service and must be excluded.
	sample := "Host: 10.0.0.1 ()\tPorts: 81/closed/tcp//hosts2-ns///\n"
	if services := parseNmapServices(sample); len(services) != 0 {
		t.Errorf("closed port must be excluded, got %d services", len(services))
	}
}

func TestParseNmapServicesCapturesProduct(t *testing.T) {
	services := parseNmapServices(nmapGreppableSample)
	svc, ok := serviceByPort(services, 465)
	if !ok {
		t.Fatal("port 465 missing")
	}
	if svc.Product != "Exim smtpd 4.99.4" {
		t.Errorf("port 465 product: got %q, want %q", svc.Product, "Exim smtpd 4.99.4")
	}
}

func TestParseNmapServicesHandlesEmptyOutput(t *testing.T) {
	if got := parseNmapServices(""); len(got) != 0 {
		t.Errorf("empty output should yield no services, got %d", len(got))
	}
}

func TestNmapServiceInvocationScopesToDiscoveredPorts(t *testing.T) {
	inv := nmapServiceInvocation("example.com", []int{80, 443, 8443})
	if inv.executable != "nmap" {
		t.Errorf("executable: got %q, want nmap", inv.executable)
	}
	joined := strings.Join(inv.args, " ")
	for _, want := range []string{"-sV", "-oG -", "-p 80,443,8443", "example.com"} {
		if !strings.Contains(joined, want) {
			t.Errorf("nmap args %q missing %q", joined, want)
		}
	}
	// The host must be the final argument, after the flags/ports.
	if inv.args[len(inv.args)-1] != "example.com" {
		t.Errorf("host should be the last argument, got %v", inv.args)
	}
}
