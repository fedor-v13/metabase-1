git reset HEAD~1
rm ./backport.sh
git cherry-pick 9731ed83c8e18ac6285f95429d501886377e9e27
echo 'Resolve conflicts and force push this branch.\n\nTo backport translations run: bin/i18n/merge-translations <release-branch>'
